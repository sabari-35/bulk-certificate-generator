import tkinter as tk
from tkinter import filedialog
from PIL import Image, ImageTk

# =============================
# TK SETUP
# =============================
root = tk.Tk()
root.title("Certificate Preview Editor")
root.state("zoomed")

# =============================
# SELECT TEMPLATE
# =============================
template_path = filedialog.askopenfilename(
    title="Select Certificate Template",
    filetypes=[("Images", "*.png *.jpg *.jpeg")]
)
if not template_path:
    exit()

orig_img = Image.open(template_path)
IMG_W, IMG_H = orig_img.size

screen_w = root.winfo_screenwidth()
screen_h = root.winfo_screenheight()

scale = min(screen_w / IMG_W, screen_h / IMG_H)

disp_w = int(IMG_W * scale)
disp_h = int(IMG_H * scale)

disp_img = orig_img.resize((disp_w, disp_h), Image.LANCZOS)

# =============================
# CANVAS
# =============================
canvas = tk.Canvas(root, bg="#555")
canvas.pack(fill="both", expand=True)
canvas.config(scrollregion=(0, 0, disp_w, disp_h))

tk_bg = ImageTk.PhotoImage(disp_img)
canvas.create_image(0, 0, anchor="nw", image=tk_bg)

# =============================
# SELECT SAMPLE PHOTO
# =============================
photo_path = filedialog.askopenfilename(
    title="Select Sample Student Photo",
    filetypes=[("Images", "*.png *.jpg *.jpeg")]
)
photo_orig = Image.open(photo_path)

photo_size = [700, 850]

def scaled_photo():
    return photo_orig.resize(
        (int(photo_size[0] * scale), int(photo_size[1] * scale)),
        Image.LANCZOS
    )

photo_tk = ImageTk.PhotoImage(scaled_photo())
photo_item = canvas.create_image(
    int(3150 * scale),
    int(2000 * scale),
    image=photo_tk,
    anchor="nw"
)

# =============================
# TEXT ITEMS
# =============================
name_font_size = 100
cert_font_size = 100

name_item = canvas.create_text(
    disp_w // 2,
    int(3600 * scale),
    text="STUDENT NAME",
    font=("Times New Roman", int(name_font_size * scale), "bold"),
    fill="black"
)

cert_item = canvas.create_text(
    int(3300 * scale),
    int(750 * scale),
    text="1 1 8 7 0",
    font=("Arial", int(cert_font_size * scale)),
    fill="black"
)

# =============================
# RESIZE HANDLES
# =============================
handles = []
active_item = None
resize_mode = None

def show_handles(item):
    hide_handles()
    bbox = canvas.bbox(item)
    if not bbox:
        return
    x1, y1, x2, y2 = bbox
    for x, y in [(x1,y1),(x2,y1),(x2,y2),(x1,y2)]:
        h = canvas.create_rectangle(
            x-6, y-6, x+6, y+6,
            fill="deepskyblue", outline="white"
        )
        handles.append(h)

def hide_handles():
    for h in handles:
        canvas.delete(h)
    handles.clear()

# =============================
# DRAG & RESIZE LOGIC
# =============================
drag = {"item": None, "x": 0, "y": 0}

def on_click(e):
    global active_item, resize_mode
    item = canvas.find_closest(e.x, e.y)[0]
    active_item = item
    drag["item"] = item
    drag["x"] = e.x
    drag["y"] = e.y
    show_handles(item)

def on_drag(e):
    if not drag["item"]:
        return
    dx = e.x - drag["x"]
    dy = e.y - drag["y"]
    canvas.move(drag["item"], dx, dy)
    drag["x"] = e.x
    drag["y"] = e.y
    show_handles(drag["item"])

def on_release(e):
    if not active_item:
        return
    x, y = canvas.coords(active_item)
    real_x = int(x / scale)
    real_y = int(y / scale)
    print(f"POSITION → x={real_x}, y={real_y}")
    drag["item"] = None

canvas.bind("<ButtonPress-1>", on_click)
canvas.bind("<B1-Motion>", on_drag)
canvas.bind("<ButtonRelease-1>", on_release)

root.mainloop()
