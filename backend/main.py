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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import io
import zipfile

# In-memory session tracking (stores data + progress)
session_store: Dict[str, dict] = {}



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
    session_store[session_id] = {
        "status": "idle", "total": 0, "current": 0, "skipped": 0,
        "excel": None, "template": None, "photos": {}, "output_zip": None
    }
    return {"session_id": session_id}

@app.post("/api/upload_excel/{session_id}")
async def upload_excel(session_id: str, file: UploadFile = File(...)):
    if session_id not in session_store:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    content = await file.read()
    session_store[session_id]["excel"] = content
    
    try:
        df = pd.read_excel(io.BytesIO(content))
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
    if session_id not in session_store:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    content = await file.read()
    session_store[session_id]["template"] = content
    return {"filename": file.filename}

@app.post("/api/upload_photos/{session_id}")
async def upload_photos(session_id: str, files: List[UploadFile] = File(...)):
    if session_id not in session_store:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    saved_count = 0
    for file in files:
        if file.filename:
            safe_filename = file.filename.replace('\\', '/').split('/')[-1]
            content = await file.read()
            session_store[session_id]["photos"][safe_filename] = content
            saved_count += 1
    return {"saved": saved_count}


def generate_certificates_task(session_id: str, config: GenerateConfig):
    if session_id not in session_store:
        return
    session_data = session_store[session_id]
    session_data["status"] = "generating"
    
    try:
        df = pd.read_excel(io.BytesIO(session_data["excel"]))
        template_io = io.BytesIO(session_data["template"])
        bg_img = Image.open(template_io).convert("RGB")
        
        pdf_io = io.BytesIO()
        pdf = rl_canvas.Canvas(pdf_io, pagesize=bg_img.size)

        session_data["total"] = len(df)
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

        available_photos = {}
        for fname, fbytes in session_data["photos"].items():
            base = clean_id(os.path.splitext(fname)[0])
            available_photos[base] = fbytes

        template_io.seek(0)
        template_reader = ImageReader(template_io)

        for index, r in df.iterrows():
            pdf.drawImage(template_reader, 0, 0, width=bg_img.width, height=bg_img.height)
            
            if config.photo_enabled and config.photo_column:
                photo_identifier = clean_id(r.get(config.photo_column, ""))
                photo_bytes = available_photos.get(photo_identifier)
                
                if not photo_bytes:
                    skipped += 1
                    session_data["skipped"] = skipped
                    session_data["current"] = index + 1
                    continue
                    
                try:
                    photo_io = io.BytesIO(photo_bytes)
                    photo_reader = ImageReader(photo_io)
                    y_photo = bg_img.height - config.photo_y - config.photo_h
                    pdf.drawImage(photo_reader, config.photo_x, y_photo, width=config.photo_w, height=config.photo_h)
                except Exception as e:
                    print(f"Error loading photo {photo_identifier}: {e}")
                    skipped += 1
                    session_data["skipped"] = skipped
                    session_data["current"] = index + 1
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
            session_data["current"] = index + 1

        if generated == 0:
            raise Exception("No certificates were generated.")

        pdf.save()
        
        # Zip output natively in memory
        zip_io = io.BytesIO()
        with zipfile.ZipFile(zip_io, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("certificates.pdf", pdf_io.getvalue())
            
        session_data["output_zip"] = zip_io.getvalue()
        session_data["status"] = "completed"
        session_data["final_generated"] = generated
        
    except Exception as e:
        session_data["status"] = "error"
        session_data["error_msg"] = str(e)


@app.post("/api/generate/{session_id}")
async def start_generation(session_id: str, config: GenerateConfig, background_tasks: BackgroundTasks):
    if session_id not in session_store:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    
    background_tasks.add_task(generate_certificates_task, session_id, config)
    return {"message": "Generation started"}

@app.get("/api/status/{session_id}")
async def get_status(session_id: str):
    if session_id not in session_store:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
        
    data = session_store[session_id]
    return {
        "status": data.get("status"),
        "total": data.get("total"),
        "current": data.get("current"),
        "skipped": data.get("skipped"),
        "error_msg": data.get("error_msg")
    }

from fastapi.responses import Response

@app.get("/api/download/{session_id}")
async def download_pdf(session_id: str):
    if session_id not in session_store or not session_store[session_id].get("output_zip"):
        return JSONResponse(status_code=404, content={"error": "ZIP not generated yet"})
        
    zip_bytes = session_store[session_id]["output_zip"]
    
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=certificates.zip"}
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
