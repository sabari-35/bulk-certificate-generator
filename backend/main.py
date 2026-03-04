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

UPLOAD_DIR = "uploads"
OUTPUT_DIR = "output"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# In-memory progress tracking
progress_store: Dict[str, dict] = {}

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
    os.makedirs(os.path.join(UPLOAD_DIR, session_id, "photos"), exist_ok=True)
    progress_store[session_id] = {"status": "idle", "total": 0, "current": 0, "skipped": 0}
    return {"session_id": session_id}

@app.post("/api/upload_excel/{session_id}")
async def upload_excel(session_id: str, file: UploadFile = File(...)):
    file_location = os.path.join(UPLOAD_DIR, session_id, "data.xlsx")
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
    file_location = os.path.join(UPLOAD_DIR, session_id, "template.png")
    with open(file_location, "wb+") as file_object:
        shutil.copyfileobj(file.file, file_object)
    return {"filename": file.filename}

@app.post("/api/upload_photos/{session_id}")
async def upload_photos(session_id: str, files: List[UploadFile] = File(...)):
    photo_dir = os.path.join(UPLOAD_DIR, session_id, "photos")
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
    progress_store[session_id]["status"] = "generating"
    
    excel_path = os.path.join(UPLOAD_DIR, session_id, "data.xlsx")
    template_path = os.path.join(UPLOAD_DIR, session_id, "template.png")
    photos_dir = os.path.join(UPLOAD_DIR, session_id, "photos")
    out_dir = os.path.join(OUTPUT_DIR, session_id)
    os.makedirs(out_dir, exist_ok=True)
    out_pdf = os.path.join(out_dir, "certificates.pdf")

    try:
        df = pd.read_excel(excel_path)
        bg_img = Image.open(template_path).convert("RGB")
        pdf = rl_canvas.Canvas(out_pdf, pagesize=bg_img.size)

        progress_store[session_id]["total"] = len(df)
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

        available_photos = {clean_id(os.path.splitext(f)[0]): f for f in os.listdir(photos_dir)}

        for index, r in df.iterrows():
            # Draw the background natively to PDF 
            pdf.drawImage(template_path, 0, 0, width=bg_img.width, height=bg_img.height)
            
            # 1. Handle Photo if enabled
            if config.photo_enabled and config.photo_column:
                photo_identifier = clean_id(r.get(config.photo_column, ""))
                photo_file = available_photos.get(photo_identifier)
                
                if not photo_file:
                    skipped += 1
                    progress_store[session_id]["skipped"] = skipped
                    progress_store[session_id]["current"] = index + 1
                    continue
                    
                photo_path = os.path.join(photos_dir, photo_file)
                try:
                    y_photo = bg_img.height - config.photo_y - config.photo_h
                    pdf.drawImage(photo_path, config.photo_x, y_photo, width=config.photo_w, height=config.photo_h)
                except Exception as e:
                    print(f"Error loading photo {photo_file}: {e}")
                    skipped += 1
                    progress_store[session_id]["skipped"] = skipped
                    progress_store[session_id]["current"] = index + 1
                    continue

            # 2. Draw Dynamic Text Elements
            import re
            for el in config.text_elements:
                val = str(r.get(el.column, ""))
                
                if el.extract_numbers:
                    val = re.sub(r'\D', '', val)
                
                if not val or val == "nan":
                    continue
                    
                rl_font = get_rl_font(el.font_family)
                font_size = int(el.font_size)
                
                # Symmetrical centering logic
                text_w = pdfmetrics.stringWidth(val, rl_font, font_size)
                draw_x = el.x + (el.w - text_w) / 2
                
                # Transform Web UI top-left coordinate to PDF bottom-left baseline coordinate.
                # In the UI, the text is vertically centered using flexbox inside `el.h`. 
                # We need to drop the text down by roughly half the box height, minus a baseline adjustment.
                draw_y = bg_img.height - el.y - (el.h / 2) - (font_size * 0.3)
                
                pdf.setFont(rl_font, font_size)
                pdf.drawString(draw_x, draw_y, val)

            pdf.showPage()
            generated += 1
            progress_store[session_id]["current"] = index + 1

        if generated == 0:
            raise Exception("No certificates were generated. Check your photo matching column or ensure your Excel file has data.")

        pdf.save()
        progress_store[session_id]["status"] = "completed"
        progress_store[session_id]["final_generated"] = generated
        
    except Exception as e:
        progress_store[session_id]["status"] = "error"
        progress_store[session_id]["error_msg"] = str(e)


@app.post("/api/generate/{session_id}")
async def start_generation(session_id: str, config: GenerateConfig, background_tasks: BackgroundTasks):
    if session_id not in progress_store:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    
    background_tasks.add_task(generate_certificates_task, session_id, config)
    return {"message": "Generation started"}

@app.get("/api/status/{session_id}")
async def get_status(session_id: str):
    if session_id not in progress_store:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    return progress_store[session_id]

@app.get("/api/download/{session_id}")
async def download_pdf(session_id: str):
    out_pdf = os.path.join(OUTPUT_DIR, session_id, "certificates.pdf")
    if os.path.exists(out_pdf):
        return FileResponse(out_pdf, filename="certificates.pdf", media_type="application/pdf")
    return JSONResponse(status_code=404, content={"error": "PDF not generated yet"})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
