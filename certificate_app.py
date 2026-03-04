import tkinter as tk
from tkinter import filedialog, messagebox
import pandas as pd
import os, uuid

from PIL import Image, ImageDraw, ImageFont, ImageTk, ImageFile
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.utils import ImageReader

ImageFile.LOAD_TRUNCATED_IMAGES = True

# =====================================================
# APP STATE
# =====================================================
STATE = {
    "excel": None,
    "photos": None,
    "template": None,
    "output": None,
    "bg_img": None,
    "scale": 1.0,
    "first_name": "STUDENT NAME",
    "first_cert": "11870"
}

PHOTO = {"x": 300, "y": 300, "w": 300, "h": 380}
NAME  = {"y": 900, "font": 60}
CERT  = {"x": 400, "y": 150, "font": 40}

# =====================================================
# TK SETUP
# =====================================================
root = tk.Tk()
root.title("Certificate Generator – Final")
root.state("zoomed")
root.configure(bg="#1e1e1e")

top = tk.Frame(root, bg="#111", height=48)
top.pack(fill="x")

status_var = tk.StringVar(value="Select Excel file to start")
status_lbl = tk.Label(
    top, textvariable=status_var,
    bg="#111", fg="#ff5252",
    font=("Segoe UI", 10, "bold")
)
status_lbl.pack(side="right", padx=12)

canvas = tk.Canvas(root, bg="#2b2b2b")
canvas.pack(fill="both", expand=True)

bg_tk = None

# =====================================================
# UTILS
# =====================================================
def set_status(text, ok=False):
    status_var.set(text)
    status_lbl.config(fg="#4CAF50" if ok else "#ff5252")

def update_generate_state():
    ready = all(STATE[k] for k in ["excel", "photos", "template", "output"])
    generate_btn.config(state=("normal" if ready else "disabled"))
    set_status(
        "Ready to generate certificates ✔" if ready else "Select all inputs",
        ok=ready
    )

def fit_scale(img):
    cw, ch = canvas.winfo_width(), canvas.winfo_height()
    if cw < 50 or ch < 50:
        return 1.0
    return min(cw / img.width, ch / img.height)

# =====================================================
# PREVIEW
# =====================================================
def redraw_preview():
    global bg_tk
    if not STATE["bg_img"]:
        return

    canvas.delete("all")

    STATE["scale"] = fit_scale(STATE["bg_img"])
    s = STATE["scale"]

    disp = STATE["bg_img"].resize(
        (int(STATE["bg_img"].width * s),
         int(STATE["bg_img"].height * s)),
        Image.LANCZOS
    )

    bg_tk = ImageTk.PhotoImage(disp)
    canvas.create_image(0, 0, anchor="nw", image=bg_tk)

    # Photo placeholder
    ph = Image.new("RGB", (PHOTO["w"], PHOTO["h"]), "#9e9e9e")
    ph = ph.resize((int(PHOTO["w"] * s), int(PHOTO["h"] * s)))
    ph_tk = ImageTk.PhotoImage(ph)
    canvas.create_image(
        int(PHOTO["x"] * s),
        int(PHOTO["y"] * s),
        image=ph_tk,
        anchor="nw"
    )
    canvas.photo_ref = ph_tk

    # Name (FROM EXCEL FIRST ROW)
    canvas.create_text(
        int(STATE["bg_img"].width * s / 2),
        int(NAME["y"] * s),
        text=STATE["first_name"],
        font=("Times New Roman", int(NAME["font"] * s), "bold"),
        fill="black"
    )

    # Certificate number (FROM EXCEL FIRST ROW)
    digits = STATE["first_cert"].replace("KPCV", "")
    for i, d in enumerate(digits):
        canvas.create_text(
            int((CERT["x"] + i * 40) * s),
            int(CERT["y"] * s),
            text=d,
            font=("Arial", int(CERT["font"] * s)),
            fill="black"
        )

# =====================================================
# LOADERS
# =====================================================
def load_excel():
    path = filedialog.askopenfilename(filetypes=[("Excel", "*.xlsx")])
    if not path:
        return

    try:
        df = pd.read_excel(path)
        if "CERTIFICATE NO" not in df.columns or "STUDENT NAME" not in df.columns:
            raise ValueError("Excel must contain 'CERTIFICATE NO' and 'STUDENT NAME'")
        first = df.iloc[0]
        STATE["first_cert"] = str(first["CERTIFICATE NO"])
        STATE["first_name"] = str(first["STUDENT NAME"]).upper()
        STATE["excel"] = path
        redraw_preview()
        update_generate_state()
    except Exception as e:
        messagebox.showerror("Excel Error", str(e))

def load_photos():
    path = filedialog.askdirectory()
    if path:
        STATE["photos"] = path
        update_generate_state()

def load_output():
    path = filedialog.askdirectory()
    if path:
        STATE["output"] = path
        update_generate_state()

def load_template():
    path = filedialog.askopenfilename(
        filetypes=[("Images", "*.png *.jpg *.jpeg")]
    )
    if not path:
        return
    STATE["template"] = path
    STATE["bg_img"] = Image.open(path).convert("RGB")
    redraw_preview()
    update_generate_state()

# =====================================================
# TOOLBAR
# =====================================================
def btn(txt, cmd, color="#e0e0e0"):
    return tk.Button(
        top, text=txt, command=cmd,
        font=("Segoe UI", 10, "bold"),
        bg=color, padx=10
    )

btn("Excel", load_excel).pack(side="left", padx=5)
btn("Photos Folder", load_photos).pack(side="left", padx=5)
btn("Template", load_template).pack(side="left", padx=5)
btn("Output Folder", load_output).pack(side="left", padx=5)

# =====================================================
# PDF GENERATION (ROBUST)
# =====================================================
def generate_pdf():
    df = pd.read_excel(STATE["excel"])
    out_path = os.path.join(STATE["output"], "certificates.pdf")

    pdf = rl_canvas.Canvas(out_path, pagesize=STATE["bg_img"].size)

    generated = 0
    skipped = 0

    for _, r in df.iterrows():
        cert = str(r["CERTIFICATE NO"]).strip()
        name = str(r["STUDENT NAME"]).strip().upper()

        photo_path = next(
            (os.path.join(STATE["photos"], f)
             for f in os.listdir(STATE["photos"])
             if os.path.splitext(f)[0].upper() == cert),
            None
        )
        if not photo_path:
            skipped += 1
            continue

        img = STATE["bg_img"].copy()
        draw = ImageDraw.Draw(img)

        photo = Image.open(photo_path).resize((PHOTO["w"], PHOTO["h"]))
        img.paste(photo, (PHOTO["x"], PHOTO["y"]))

        nf = ImageFont.truetype("C:/Windows/Fonts/timesbd.ttf", NAME["font"])
        w = draw.textbbox((0, 0), name, font=nf)[2]
        draw.text(((img.width - w)//2, NAME["y"]),
                  name, font=nf, fill="black")

        cf = ImageFont.truetype("arial.ttf", CERT["font"])
        for i, d in enumerate(cert.replace("KPCV", "")):
            draw.text((CERT["x"] + i*40, CERT["y"]),
                      d, font=cf, fill="black")

        tmp = f"_tmp_{uuid.uuid4().hex}.png"
        img.save(tmp, dpi=(300, 300))
        pdf.drawImage(ImageReader(tmp), 0, 0)
        pdf.showPage()
        os.remove(tmp)

        generated += 1

    pdf.save()
    messagebox.showinfo(
        "Completed",
        f"Certificates generated: {generated}\nSkipped (photo missing): {skipped}"
    )

generate_btn = btn("GENERATE PDF", generate_pdf, "#4CAF50")
generate_btn.pack(side="left", padx=10)
generate_btn.config(state="disabled")

canvas.bind("<Configure>", lambda e: redraw_preview())

root.mainloop()
