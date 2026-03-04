import pandas as pd
import os
import uuid
from PIL import Image, ImageDraw, ImageFont, ImageFile
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader

# =====================================================
# FIX FOR TRUNCATED / PARTIAL JPG FILES
# =====================================================
ImageFile.LOAD_TRUNCATED_IMAGES = True

# =====================================================
# PATH CONFIGURATION
# =====================================================
EXCEL_FILE = "ses4B.xlsx"
TEMPLATE = "session4.png"
PHOTO_DIR = "session4"
OUTPUT_DIR = "output/ses4"

os.makedirs(OUTPUT_DIR, exist_ok=True)

# =====================================================
# LOAD EXCEL DATA
# =====================================================
df = pd.read_excel(EXCEL_FILE)

# =====================================================
# LOAD FONTS
# =====================================================
NAME_FONT = ImageFont.truetype("C:/Windows/Fonts/timesbd.ttf", 100)
SMALL_FONT = ImageFont.truetype("arial.ttf", 100)

# =====================================================
# PHOTO PLACEHOLDER
# =====================================================
PHOTO_X = 3150
PHOTO_Y = 2000
PHOTO_W = 700
PHOTO_H = 850

# =====================================================
# NAME ALIGNMENT
# =====================================================
NAME_Y = 3600
NAME_X_OFFSET = 0

# =====================================================
# CERTIFICATE NUMBER DIGIT POSITIONS
# =====================================================
BASE_DIGIT_POSITIONS = [
    (3300, 750),
    (3370, 750),
    (3440, 750),
    (3510, 750),
    (3580, 750),
]

# =====================================================
# IMAGE EXTENSIONS SUPPORTED
# =====================================================
IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"]

def find_photo(cert_no):
    for file in os.listdir(PHOTO_DIR):
        name, ext = os.path.splitext(file)
        if name.upper() == cert_no.upper() and ext.lower() in IMAGE_EXTENSIONS:
            return os.path.join(PHOTO_DIR, file)
    return None

# =====================================================
# MAIN PROCESS
# =====================================================
for _, row in df.iterrows():
    cert = str(row["CERTIFICATE NO."]).strip()
    name = str(row["STUDENT NAME"]).strip().upper()

    photo_path = find_photo(cert)

    if not photo_path:
        print(f"❌ Photo missing: {cert}")
        continue

    # -------------------------------------------------
    # LOAD TEMPLATE
    # -------------------------------------------------
    img = Image.open(TEMPLATE).convert("RGB")
    draw = ImageDraw.Draw(img)

    # -------------------------------------------------
    # INSERT PHOTO
    # -------------------------------------------------
    photo = Image.open(photo_path).convert("RGB")
    photo = photo.resize((PHOTO_W, PHOTO_H))
    img.paste(photo, (PHOTO_X, PHOTO_Y))

    # -------------------------------------------------
    # INSERT NAME (CENTERED)
    # -------------------------------------------------
    bbox = draw.textbbox((0, 0), name, font=NAME_FONT)
    name_width = bbox[2] - bbox[0]
    name_x = ((img.width - name_width) // 2) + NAME_X_OFFSET

    draw.text((name_x, NAME_Y), name, fill="black", font=NAME_FONT)

    # -------------------------------------------------
    # INSERT CERTIFICATE NUMBER DIGITS
    # -------------------------------------------------
    digits = cert.replace("KPCV", "")

    for d, (x, y) in zip(digits, BASE_DIGIT_POSITIONS):
        draw.text((x, y), d, fill="black", font=SMALL_FONT)

    # -------------------------------------------------
    # SAVE TEMP IMAGE (UNIQUE NAME)
    # -------------------------------------------------
    temp_img = f"temp_{cert}_{uuid.uuid4().hex}.png"
    img.save(temp_img, dpi=(300, 300))

    # -------------------------------------------------
    # EXPORT TO PDF (CORRECT METHOD)
    # -------------------------------------------------
    pdf_path = os.path.join(OUTPUT_DIR, f"{cert}.pdf")
    c = canvas.Canvas(pdf_path, pagesize=A4)

    img_reader = ImageReader(temp_img)
    c.drawImage(
        img_reader,
        0,
        0,
        width=A4[0],
        height=A4[1],
        preserveAspectRatio=True
    )

    c.save()
    os.remove(temp_img)

    print(f"✅ Generated: {cert}.pdf")

print("🎉 ALL CERTIFICATES GENERATED SUCCESSFULLY")
