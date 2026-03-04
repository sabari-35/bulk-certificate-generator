import pandas as pd
import os
from PIL import Image, ImageDraw, ImageFont, ImageFile
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

# =====================================================
# FIX FOR TRUNCATED / PARTIAL JPG FILES
# =====================================================
ImageFile.LOAD_TRUNCATED_IMAGES = True

# =====================================================
# PATH CONFIGURATION
# =====================================================
EXCEL_FILE = "ses1A.xlsx"          # Excel with student data
TEMPLATE = "27.11.25 - 29.11.25.png"         # Canva exported blank certificate
PHOTO_DIR = "session1"              # Folder with student photos
OUTPUT_DIR = "output/pdfs"        # Output PDFs

os.makedirs(OUTPUT_DIR, exist_ok=True)

# =====================================================
# LOAD EXCEL DATA
# =====================================================
df = pd.read_excel(EXCEL_FILE)

# =====================================================
# LOAD FONTS
# =====================================================
# Same font as "INDUSTRIAL AUTOMATION"
NAME_FONT = ImageFont.truetype("C:/Windows/Fonts/timesbd.ttf", 44)
NAME_FONTS = ImageFont.truetype("C:/Windows/Fonts/timesbd.ttf", 38)

# Department only (same font, smaller size)
DEPT_FONT = ImageFont.truetype("C:/Windows/Fonts/timesbd.ttf", 32)

# Keep existing small font for digits
SMALL_FONT = ImageFont.truetype("arial.ttf", 32)


# =====================================================
# PHOTO PLACEHOLDER (SYNCED TO TEMPLATE)
# =====================================================
PHOTO_X = 1012
PHOTO_Y = 647
PHOTO_W = 215
PHOTO_H = 245

# =====================================================
# NAME & DEPARTMENT ALIGNMENT
# =====================================================
NAME_Y = 1150         # dotted line Y
DEPT_X = 1105         # Dept text X
DEPT_Y = 1162     # same baseline as name

# =====================================================
# CERTIFICATE NUMBER DIGIT ALIGNMENT (5 DIGITS)
# =====================================================
DX = 0   # move digits left/right (+/-)
DY = 0   # move digits up/down (+/-)

BASE_DIGIT_POSITIONS = [
    (1050, 238),  # digit 1
    (1075, 238),  # digit 2
    (1100, 238),  # digit 3
    (1125, 238),  # digit 4
    (1150, 238),  # digit 5
]

DIGIT_POSITIONS = [(x + DX, y + DY) for x, y in BASE_DIGIT_POSITIONS]

# =====================================================
# MAIN PROCESS
# =====================================================
for _, row in df.iterrows():
    cert = str(row["CERTIFICATE NO."]).strip()
    dept = str(row["DEPT NO"]).strip()
    # e.g. KPCV11315
    name = str(row["STUDENT NAME"]).strip().upper()
    IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"]

def find_photo(cert_no):
    for file in os.listdir(PHOTO_DIR):
        name, ext = os.path.splitext(file)
        if name.upper() == cert_no.upper() and ext.lower() in IMAGE_EXTENSIONS:
            return os.path.join(PHOTO_DIR, file)
    return None


    # photo_path = os.path.join(PHOTO_DIR, f"{cert}.JPG")

    # if not os.path.exists(photo_path):
    #     print(f"❌ Photo missing: {cert}.JPG")
    #     continue

    # -------------------------------------------------
    # LOAD TEMPLATE
    # -------------------------------------------------
    img = Image.open(TEMPLATE).convert("RGB")
    draw = ImageDraw.Draw(img)

    # -------------------------------------------------
    # INSERT PHOTO (REPLACES PLACEHOLDER)
    # -------------------------------------------------
    photo = Image.open(photo_path).convert("RGB")
    photo = photo.resize((PHOTO_W, PHOTO_H))
    img.paste(photo, (PHOTO_X, PHOTO_Y))

    # -------------------------------------------------
    # INSERT NAME (CENTERED ON DOTTED LINE)
    # -------------------------------------------------
    bbox = draw.textbbox((0, 0), name, font=NAME_FONT)
    name_width = bbox[2] - bbox[0]
    name_x = (img.width - name_width) // 2

    draw.text((name_x, NAME_Y), name, fill="black", font=NAME_FONTS)

    # -------------------------------------------------
    # INSERT DEPARTMENT
    # -------------------------------------------------
    draw.text((DEPT_X, DEPT_Y), dept, fill="black", font=DEPT_FONT)

    # -------------------------------------------------
    # INSERT CERTIFICATE NUMBER DIGITS (5 DIGITS)
    # -------------------------------------------------
    digits = cert.replace("KPCV", "")  # "11315"

    for d, (x, y) in zip(digits, DIGIT_POSITIONS):
        draw.text((x, y), d, fill="black", font=SMALL_FONT)

    # -------------------------------------------------
    # SAVE TEMP IMAGE
    # -------------------------------------------------
    temp_img = f"temp_{cert}.png"
    img.save(temp_img)

    # -------------------------------------------------
    # EXPORT TO A4 PDF (PRINT READY)
    # -------------------------------------------------
    pdf_path = os.path.join(OUTPUT_DIR, f"{cert}.pdf")
    c = canvas.Canvas(pdf_path, pagesize=A4)
    c.drawImage(temp_img, 0, 0, width=595, height=842)
    c.save()

    os.remove(temp_img)
    print(f"✅ Generated: {cert}.pdf")

print("🎉 ALL CERTIFICATES GENERATED SUCCESSFULLY")
