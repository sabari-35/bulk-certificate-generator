import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import imageCompression from 'browser-image-compression';

export interface TextElement {
  id: string;
  column: string;
  x: number;
  y: number;
  w: number;
  h: number;
  font_size: number;
  font_family: string;
  extract_numbers?: boolean;
}

export interface GenerationConfig {
  photo_enabled: boolean;
  photo_column: string;
  photo_x: number;
  photo_y: number;
  photo_w: number;
  photo_h: number;
  text_elements: TextElement[];
}

export interface ProgressState {
  total: number;
  current: number;
  skipped: number;
  error_msg: string;
  status: 'idle' | 'generating' | 'completed' | 'error';
}

const getWeightForFont = (fontFile: string) => {
  return (fontFile.toLowerCase().includes('bd') || fontFile.toLowerCase().includes('bold')) ? 'bold' : 'normal';
};

const getFamilyForFont = (fontFile: string) => {
  const f = fontFile.toLowerCase();
  if (f.includes('times')) return 'Times';
  if (f.includes('courier')) return 'Courier';
  return 'Helvetica'; // Fallback to safe jsPDF font
};

// Helper to convert File/Blob to base64 Data URL, which jsPDF handles perfectly
const fileToBase64 = (file: File | Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const getImageDimensions = (dataUrl: string): Promise<{ width: number, height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = reject;
    img.src = dataUrl;
  });
};

export const generateCertificates = async (
  excelFile: File,
  templateFile: File,
  photosList: FileList | null,
  config: GenerationConfig,
  onProgress: (progress: ProgressState) => void
) => {
  try {
    onProgress({ total: 0, current: 0, skipped: 0, error_msg: '', status: 'generating' });

    // 1. Parse Excel
    const data = await excelFile.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheet = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets[firstSheet]);
    
    if (rows.length === 0) {
      throw new Error("Excel file is empty");
    }

    const totalRecords = Math.min(rows.length, 500); // Max 500 safety limit
    let currentCount = 0;
    let skippedCount = 0;

    // 2. Compress & Load Template Image
    const options = { maxSizeMB: 1, maxWidthOrHeight: 2500, useWebWorker: true };
    const optimizedTemplate = await imageCompression(templateFile, options);
    
    const templateDataUrl = await fileToBase64(optimizedTemplate);
    const { width: bgWidth, height: bgHeight } = await getImageDimensions(templateDataUrl);

    // 3. Map Photos for fast lookup
    const photoMap = new Map<string, File>();
    if (photosList && config.photo_enabled) {
      for (let i = 0; i < photosList.length; i++) {
        const file = photosList[i];
        // match exact name minus extension
        const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')).toUpperCase().trim() || file.name.toUpperCase().trim();
        photoMap.set(nameWithoutExt, file);
      }
    }

    // Pre-process photos into base64 to avoid doing it repeatedly if they repeat
    const processedPhotos = new Map<string, string>();

    // 4. Setup JSZip
    const zip = new JSZip();

    // 5. Generate process
    // We yield back to main thread periodically so UI doesn't freeze
    for (let i = 0; i < totalRecords; i++) {
      const row = rows[i];
      let identifierForPhoto = '';

      if (config.photo_enabled && config.photo_column) {
        identifierForPhoto = String(row[config.photo_column] || '').toUpperCase().trim();
      }
      
      const hasMissingText = config.text_elements.some(el => {
         const val = String(row[el.column] || '');
         return !val || val === 'undefined';
      });

      if (hasMissingText) {
         skippedCount++;
         onProgress({ total: totalRecords, current: currentCount, skipped: skippedCount, error_msg: '', status: 'generating' });
         continue;
      }

      // Create PDF
      const doc = new jsPDF({
        orientation: bgWidth > bgHeight ? 'landscape' : 'portrait',
        unit: 'px',
        format: [bgWidth, bgHeight],
        compress: true // Compress PDF to keep zip small
      });

      // Draw Template
      doc.addImage(templateDataUrl, 'JPEG', 0, 0, bgWidth, bgHeight);

      // Draw Photo
      if (config.photo_enabled && identifierForPhoto) {
        const photoFile = photoMap.get(identifierForPhoto);
        if (photoFile) {
          try {
            let pDataUrl = processedPhotos.get(identifierForPhoto);
            if (!pDataUrl) {
               pDataUrl = await fileToBase64(photoFile);
               processedPhotos.set(identifierForPhoto, pDataUrl);
            }
            doc.addImage(pDataUrl, 'JPEG', config.photo_x, config.photo_y, config.photo_w, config.photo_h);
          } catch(e) {
            console.warn(`Failed to process photo for ${identifierForPhoto}`);
          }
        }
      }

      // Draw Text Elements
      for (const el of config.text_elements) {
        let val = String(row[el.column] || '');
        if (el.extract_numbers) {
          val = val.replace(/\D/g, '');
        }

        const family = getFamilyForFont(el.font_family);
        const style = getWeightForFont(el.font_family);
        
        doc.setFont(family, style);
        doc.setFontSize(el.font_size);
        
        // Calculate centered X if needed or just use X
        // Assuming App.tsx handles X as top/left. If App.tsx centers, we'd adjust, but jsPDF text is drawn from bottom-left by default.
        // Wait, jsPDF coordinate is from Top-Left, but text is drawn at baseline. We must add font size roughly.
        // Also App.tsx used x,y for top-left of standard bounding box.
        
        const drawX = el.x;
        const textWidth = doc.getTextWidth(val);
        // Center text horizontally within width (el.w)
        const centeredX = drawX + (el.w - textWidth) / 2;
        
        // Vertically center (el.h) - add font size / 3 for baseline descender compensation
        const centeredY = el.y + (el.h / 2) + (el.font_size / 3);

        doc.text(val, centeredX, centeredY);
      }

      // Save PDF to Zip
      const pdfBlob = doc.output('blob');
      
      // Determine file name
      // Use photo identifier or first text column as document name
      let docName = `Certificate_${i + 1}`;
      if (identifierForPhoto) {
        docName = identifierForPhoto;
      } else if (config.text_elements.length > 0) {
        // Fallback to the first text element's value (e.g., student name or ID)
        const colName = config.text_elements[0].column;
        const val = String(row[colName] || '').replace(/[^a-z0-9_-]/gi, '_');
        if (val) docName = val;
      }
      
      zip.file(`${docName}.pdf`, pdfBlob);
      
      currentCount++;

      // Update progress every 10 items or at the end so UI doesn't clutter
      if (i % 5 === 0 || i === totalRecords - 1) {
        onProgress({ total: totalRecords, current: currentCount, skipped: skippedCount, error_msg: '', status: 'generating' });
        // Yield to browser UI thread
        await new Promise(r => setTimeout(r, 0));
      }
    }

    if (currentCount === 0) {
      throw new Error("No certificates were generated. Check your data and element bindings.");
    }

    // Generate ZIP
    const zipContent = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        // optionally update progress here for zipping phase
    });

    saveAs(zipContent, 'certificates.zip');

    onProgress({ total: totalRecords, current: currentCount, skipped: skippedCount, error_msg: '', status: 'completed' });

  } catch (err: any) {
    onProgress({ total: 0, current: 0, skipped: 0, error_msg: err.message || 'Unknown error occurred', status: 'error' });
  }
};
