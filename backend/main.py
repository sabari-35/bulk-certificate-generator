import os
import shutil
import uuid
import pandas as pd
from typing import List, Dict, Optional
from fastapi import FastAPI, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics

app = FastAPI(title="Certificate Generator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

import io
import zipfile
import tempfile
import json

# Use system temp directory to guarantee writability across Serverless/Render/Heroku/Multi-worker
BASE_DIR = os.path.join(tempfile.gettempdir(), "bulkcert_sessions")
os.makedirs(BASE_DIR, exist_ok=True)

def get_session_dir(session_id: str):
    return os.path.join(BASE_DIR, session_id)

def read_status(session_id: str):
    sf = os.path.join(get_session_dir(session_id), "status.json")
    if os.path.exists(sf):
        try:
            with open(sf, "r") as f:
                return json.load(f)
        except:
            return None
    return None

def update_status(session_id: str, updates: dict):
    sf = os.path.join(get_session_dir(session_id), "status.json")
    data = read_status(session_id) or {}
    data.update(updates)
    with open(sf, "w") as f:
        json.dump(data, f)


class TextElementConfig(BaseModel):
    id: str
    column: str
    x: float
    y: float
    w: float
    h: float
    font_size: float
    font_family: str
    extract_numbers: bool = False

class GenerateConfig(BaseModel):
    photo_enabled: bool = False
    photo_column: str = ""
    photo_x: float = 300
    photo_y: float = 300
    photo_w: float = 300
    photo_h: float = 380
    text_elements: List[TextElementConfig] = []

@app.post("/api/init_session")
async def init_session():
    session_id = uuid.uuid4().hex
    session_dir = get_session_dir(session_id)
    os.makedirs(os.path.join(session_dir, "photos"), exist_ok=True)
    update_status(session_id, {
        "status": "idle", "total": 0, "current": 0, "skipped": 0, "error_msg": ""
    })
    return {"session_id": session_id}

@app.post("/api/upload_excel/{session_id}")
async def upload_excel(session_id: str, file: UploadFile = File(...)):
    session_dir = get_session_dir(session_id)
    if not os.path.exists(session_dir):
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    
    file_location = os.path.join(session_dir, "data.xlsx")
    with open(file_location, "wb+") as file_object:
        shutil.copyfileobj(file.file, file_object)
    
    try:
        df = pd.read_excel(file_location)
        headers = df.columns.tolist()
        
        if len(df) == 0:
            return JSONResponse(status_code=400, content={"error": "Excel file is empty"})
        
        first_row = df.iloc[0]
        preview_data = {}
        for h in headers:
            val = first_row[h]
            preview_data[h] = str(val) if pd.notna(val) else ""
            
        return {
            "filename": file.filename, 
            "headers": headers,
            "preview_data": preview_data
        }
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

@app.post("/api/upload_template/{session_id}")
async def upload_template(session_id: str, file: UploadFile = File(...)):
    session_dir = get_session_dir(session_id)
    if not os.path.exists(session_dir):
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    
    file_location = os.path.join(session_dir, "template.png")
    with open(file_location, "wb+") as file_object:
        shutil.copyfileobj(file.file, file_object)
        
    return {"filename": file.filename}

@app.post("/api/upload_photos/{session_id}")
async def upload_photos(session_id: str, files: List[UploadFile] = File(...)):
    session_dir = get_session_dir(session_id)
    if not os.path.exists(session_dir):
        return JSONResponse(status_code=404, content={"error": "Session not found"})
        
    photo_dir = os.path.join(session_dir, "photos")
    os.makedirs(photo_dir, exist_ok=True)
    saved_count = 0
    for file in files:
        if file.filename:
            safe_filename = file.filename.replace('\\', '/').split('/')[-1]
            file_location = os.path.join(photo_dir, safe_filename)
            with open(file_location, "wb+") as file_object:
                shutil.copyfileobj(file.file, file_object)
            saved_count += 1
    return {"saved": saved_count}


def generate_certificates_task(session_id: str, config: GenerateConfig):
    session_dir = get_session_dir(session_id)
    if not os.path.exists(session_dir):
        return
        
    update_status(session_id, {"status": "generating"})
    
    excel_path = os.path.join(session_dir, "data.xlsx")
    template_path = os.path.join(session_dir, "template.png")
    photos_dir = os.path.join(session_dir, "photos")
    out_pdf = os.path.join(session_dir, "certificates.pdf")
    zip_path = os.path.join(session_dir, "certificates.zip")
    
    try:
        if not os.path.exists(excel_path):
            raise Exception("Excel data is missing in session.")
        df = pd.read_excel(excel_path)
        
        if not os.path.exists(template_path):
            raise Exception("Template image is missing in session.")
            
        try:
            bg_img = Image.open(template_path).convert("RGB")
        except Exception as e:
            raise Exception(f"Failed to decode template image: {e}")
        
        pdf = rl_canvas.Canvas(out_pdf, pagesize=bg_img.size)

        update_status(session_id, {"total": len(df)})
        generated = 0
        skipped = 0

        registered_fonts = set()
        def get_rl_font(family):
            base_family = family.split('.')[0]
            if base_family not in registered_fonts:
                try:
                    pdfmetrics.registerFont(TTFont(base_family, f"C:/Windows/Fonts/{family}"))
                    registered_fonts.add(base_family)
                except:
                    try:
                        pdfmetrics.registerFont(TTFont(base_family, family))
                        registered_fonts.add(base_family)
                    except:
                        return "Helvetica"
            return base_family

        def clean_id(s):
            return str(s).strip().replace(" ", "").upper()

        available_photos = {clean_id(os.path.splitext(f)[0]): f for f in os.listdir(photos_dir)} if os.path.exists(photos_dir) else {}

        for index, r in df.iterrows():
            pdf.drawImage(template_path, 0, 0, width=bg_img.width, height=bg_img.height)
            
            if config.photo_enabled and config.photo_column:
                photo_identifier = clean_id(r.get(config.photo_column, ""))
                photo_file = available_photos.get(photo_identifier)
                
                if not photo_file:
                    skipped += 1
                    update_status(session_id, {"skipped": skipped, "current": index + 1})
                    continue
                    
                photo_path = os.path.join(photos_dir, photo_file)
                try:
                    with Image.open(photo_path) as photo_img:
                        photo_reader = ImageReader(photo_img)
                        y_photo = bg_img.height - config.photo_y - config.photo_h
                        pdf.drawImage(photo_reader, config.photo_x, y_photo, width=config.photo_w, height=config.photo_h)
                except Exception as e:
                    print(f"Error decoding photo {photo_identifier}: {e}")
                    skipped += 1
                    update_status(session_id, {"skipped": skipped, "current": index + 1})
                    continue

            import re
            for el in config.text_elements:
                val = str(r.get(el.column, ""))
                
                if el.extract_numbers:
                    val = re.sub(r'\D', '', val)
                
                if not val or val == "nan":
                    continue
                    
                rl_font = get_rl_font(el.font_family)
                font_size = int(el.font_size)
                
                text_w = pdfmetrics.stringWidth(val, rl_font, font_size)
                draw_x = el.x + (el.w - text_w) / 2
                draw_y = bg_img.height - el.y - (el.h / 2) - (font_size * 0.3)
                
                pdf.setFont(rl_font, font_size)
                pdf.drawString(draw_x, draw_y, val)

            pdf.showPage()
            generated += 1
            if index % 5 == 0:  # Don't thrash the disk with IO on every single cert
                update_status(session_id, {"current": index + 1})

        if generated == 0:
            raise Exception("No certificates were generated.")

        pdf.save()
        
        # Create ZIP physically
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(out_pdf, "certificates.pdf")
            
        update_status(session_id, {
            "status": "completed", 
            "final_generated": generated,
            "current": len(df)
        })
        
    except Exception as e:
        update_status(session_id, {"status": "error", "error_msg": str(e)})


@app.post("/api/generate/{session_id}")
async def start_generation(session_id: str, config: GenerateConfig, background_tasks: BackgroundTasks):
    if not os.path.exists(get_session_dir(session_id)):
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    
    background_tasks.add_task(generate_certificates_task, session_id, config)
    return {"message": "Generation started"}

@app.get("/api/status/{session_id}")
async def get_status(session_id: str):
    data = read_status(session_id)
    if not data:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    return data

from fastapi.responses import FileResponse

@app.get("/api/download/{session_id}")
async def download_pdf(session_id: str):
    zip_path = os.path.join(get_session_dir(session_id), "certificates.zip")
    if not os.path.exists(zip_path):
        return JSONResponse(status_code=404, content={"error": "ZIP not generated yet"})
        
    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename="certificates.zip"
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
