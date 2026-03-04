import os
from PyPDF2 import PdfMerger

# ===============================
# PATH CONFIGURATION
# ===============================
INPUT_FOLDER = "output/ses4"
OUTPUT_FOLDER = "output"
OUTPUT_FILE = "KPC-SESSION4-MOD.pdf"

os.makedirs(OUTPUT_FOLDER, exist_ok=True)

output_path = os.path.join(OUTPUT_FOLDER, OUTPUT_FILE)

# ===============================
# PDF MERGING LOGIC
# ===============================
merger = PdfMerger()

pdf_files = sorted([
    file for file in os.listdir(INPUT_FOLDER)
    if file.lower().endswith(".pdf")
])

if not pdf_files:
    print("❌ No PDF files found!")
    exit()

for pdf in pdf_files:
    file_path = os.path.join(INPUT_FOLDER, pdf)
    merger.append(file_path)
    print(f"✔ Added: {pdf}")

merger.write(output_path)
merger.close()

print("\n✅ SUCCESS!")
print(f"📄 Total PDFs merged: {len(pdf_files)}")
print(f"📂 Output file saved at: {output_path}")
