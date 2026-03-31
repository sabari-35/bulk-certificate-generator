import React, { useState, useRef, useEffect, SyntheticEvent } from 'react';
import { 
  FileSpreadsheet, Image as ImageIcon, Folder, Settings, 
  Download, Play, CheckCircle2, AlertCircle, Plus, X, Trash2,
  ChevronLeft, ChevronRight, Layout, Type, Image as ImgIcon, MousePointer2 
} from 'lucide-react';
import { Rnd } from 'react-rnd';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { generateCertificates, ProgressState } from './utils/generate';
import './index.css';

// Initialize Supabase client
const SUPABASE_URL = 'https://yolgqavimghcmpkqmhdy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvbGdxYXZpbWdoY21wa3FtaGR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMjA2MjIsImV4cCI6MjA4ODU5NjYyMn0.NK6_eoUFYB6Zic5IqevDrdWnbLkmTxY_OwASDBRK60Q';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface TextElement {
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

interface Config {
  photo_enabled: boolean;
  photo_column: string;
  photo_x: number;
  photo_y: number;
  photo_w: number;
  photo_h: number;
  text_elements: TextElement[];
}

const FONTS = [
  { label: 'Arial', value: 'arial.ttf' },
  { label: 'Arial (Bold)', value: 'arialbd.ttf' },
  { label: 'Times New Roman', value: 'times.ttf' },
  { label: 'Times New Roman (Bold)', value: 'timesbd.ttf' },
  { label: 'Calibri', value: 'calibri.ttf' },
  { label: 'Georgia', value: 'georgia.ttf' },
];

const getCssForFont = (fontFile: string): React.CSSProperties => {
  let family = 'Arial';
  let weight: React.CSSProperties['fontWeight'] = 'normal';

  const f = fontFile.toLowerCase();
  if (f.includes('times')) family = '"Times New Roman", Times, serif';
  else if (f.includes('calibri')) family = 'Calibri, sans-serif';
  else if (f.includes('georgia')) family = 'Georgia, serif';

  if (f.includes('bd') || f.includes('bold')) weight = 'bold';

  return { fontFamily: family, fontWeight: weight };
};

function App() {
  const [downloadMode, setDownloadMode] = useState<'zip' | 'merged'>('zip');
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<Record<string, string>[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);

  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templateUrl, setTemplateUrl] = useState<string | null>(null);

  const [photos, setPhotos] = useState<FileList | null>(null);

  const [bgSize, setBgSize] = useState({ width: 2000, height: 1414 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [activeElement, setActiveElement] = useState<string | null>(null);

  const [config, setConfig] = useState<Config>({
    photo_enabled: false,
    photo_column: '',
    photo_x: 100,
    photo_y: 100,
    photo_w: 300,
    photo_h: 380,
    text_elements: []
  });

  const [status, setStatus] = useState<'idle' | 'generating' | 'completed' | 'error'>('idle');
  const [progress, setProgress] = useState({ total: 0, current: 0, skipped: 0, error_msg: '' });
  const [isUploading, setIsUploading] = useState(false);

  // History State
  const [past, setPast] = useState<Config[]>([]);
  const [future, setFuture] = useState<Config[]>([]);

  const updateConfigWithHistory = (newConfigOrUpdater: React.SetStateAction<Config>) => {
    setConfig(prev => {
      const nextConfig = typeof newConfigOrUpdater === 'function' ? (newConfigOrUpdater as any)(prev) : newConfigOrUpdater;
      setPast(p => [...p, prev]);
      setFuture([]);
      return nextConfig;
    });
  };

  const undo = () => {
    setPast(p => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1];
      setConfig(current => {
        setFuture(f => [current, ...f]);
        return previous;
      });
      return p.slice(0, p.length - 1);
    });
  };

  const redo = () => {
    setFuture(f => {
      if (f.length === 0) return f;
      const next = f[0];
      setConfig(current => {
        setPast(p => [...p, current]);
        return next;
      });
      return f.slice(1);
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        redo();
        return;
      }

      if (!activeElement) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (activeElement === 'PHOTO') {
          updateConfigWithHistory(c => ({ ...c, photo_enabled: false }));
          setActiveElement(null);
        } else {
          updateConfigWithHistory(c => ({ ...c, text_elements: c.text_elements.filter(el => el.id !== activeElement) }));
          setActiveElement(null);
        }
        return;
      }

      const step = e.shiftKey ? 10 : 1;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        if (activeElement === 'PHOTO') {
          updateConfigWithHistory(c => {
            let { photo_x, photo_y } = c;
            if (e.key === 'ArrowUp') photo_y -= step;
            if (e.key === 'ArrowDown') photo_y += step;
            if (e.key === 'ArrowLeft') photo_x -= step;
            if (e.key === 'ArrowRight') photo_x += step;
            return { ...c, photo_x, photo_y };
          });
        } else {
          updateConfigWithHistory(c => ({
            ...c,
            text_elements: c.text_elements.map(el => {
              if (el.id === activeElement) {
                let { x, y } = el;
                if (e.key === 'ArrowUp') y -= step;
                if (e.key === 'ArrowDown') y += step;
                if (e.key === 'ArrowLeft') x -= step;
                if (e.key === 'ArrowRight') x += step;
                return { ...el, x, y };
              }
              return el;
            })
          }));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeElement]);

  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current && templateUrl) {
        const cw = containerRef.current.clientWidth;
        const ch = containerRef.current.clientHeight;
        const scaleX = (cw - 40) / bgSize.width;
        const scaleY = (ch - 40) / bgSize.height;
        setScale(Math.min(scaleX, scaleY, 1));
      }
    };
    window.addEventListener('resize', updateScale);
    // Initial scale check with slight delay to ensure DOM is ready
    setTimeout(updateScale, 50);
    return () => window.removeEventListener('resize', updateScale);
  }, [bgSize, templateUrl, status]);

  const onImageLoad = (e: SyntheticEvent<HTMLImageElement, Event>) => {
    const img = e.currentTarget;
    setBgSize({ width: img.naturalWidth, height: img.naturalHeight });
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setExcelFile(file);
      setIsUploading(true);
      try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets[firstSheet]);
        
        if (rows.length > 0) {
           const headersList = Object.keys(rows[0]);
           setHeaders(headersList);
           
           const stringRows = rows.map(row => {
             const strRow: Record<string, string> = {};
             headersList.forEach(h => { strRow[h] = String(row[h] || ''); });
             return strRow;
           });
           
           setAllRows(stringRows);
           setPreviewIndex(0);

           let pCol = config.photo_column;
           if (!pCol && headersList.length > 0) {
             pCol = headersList.find(h => h.toUpperCase().includes('CERTIFICATE') || h.toUpperCase().includes('ID')) || headersList[0];
             setConfig(prev => ({ ...prev, photo_column: pCol }));
           }
        } else {
           throw new Error("Excel file is empty");
        }
      } catch (err: any) {
        alert("Error: " + (err.message));
        setExcelFile(null);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setTemplateFile(file);
      // Removed heavy browser-image-compression for instant canvas preview.
      setTemplateUrl(URL.createObjectURL(file));
    }
  };

  const handlePhotosUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setPhotos(e.target.files);
      setConfig(prev => ({ ...prev, photo_enabled: true }));
    }
  };

  const addTextElement = (columnName: string) => {
    const newEl: TextElement = {
      id: Math.random().toString(36).substr(2, 9),
      column: columnName,
      x: bgSize.width / 2 - 250,
      y: bgSize.height / 2,
      w: 500,
      h: 80,
      font_size: 40,
      font_family: 'arialbd.ttf'
    };
    updateConfigWithHistory(c => ({ ...c, text_elements: [...c.text_elements, newEl] }));
    setActiveElement(newEl.id);
  };

  const removeTextElement = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    updateConfigWithHistory(c => ({
      ...c,
      text_elements: c.text_elements.filter(el => el.id !== id)
    }));
    if (activeElement === id) setActiveElement(null);
  };

  const updateTextElement = (id: string, updates: Partial<TextElement>) => {
    updateConfigWithHistory(c => ({
      ...c,
      text_elements: c.text_elements.map(el => el.id === id ? { ...el, ...updates } : el)
    }));
  };

  const startGeneration = async () => {
    if (!excelFile || !templateFile) return;
    setStatus('generating');
    
    await generateCertificates(excelFile, templateFile, photos, config, downloadMode, (prog: ProgressState) => {
        setProgress(prog);
        setStatus(prog.status);
    });
  };

  const handleDownload = () => {
    alert(downloadMode === 'zip' 
      ? "ZIP file was already downloaded to your computer automatically!" 
      : "Merged PDF was already downloaded to your computer automatically!");
  };

  const allReady = excelFile && templateFile;
  const currentPreviewData = allRows.length > 0 ? allRows[previewIndex] : {};

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <header className="topbar">
        <div className="brand">
          <Layout size={24} /> 
          <span>Certificate Studio</span>
        </div>
        <div className="topbar-actions">
          {isUploading && <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Processing files...</span>}
          <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--bg-secondary)', padding: '0.25rem', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
            <button className={`btn btn-sm ${downloadMode === 'zip' ? 'btn-primary' : ''}`} onClick={() => setDownloadMode('zip')} style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', background: downloadMode === 'zip' ? 'var(--accent-primary)' : 'transparent', color: downloadMode === 'zip' ? 'white' : 'var(--text-primary)', border: 'none', cursor: 'pointer', borderRadius: '4px' }}>ZIP (Individual)</button>
            <button className={`btn btn-sm ${downloadMode === 'merged' ? 'btn-primary' : ''}`} onClick={() => setDownloadMode('merged')} style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', background: downloadMode === 'merged' ? 'var(--accent-primary)' : 'transparent', color: downloadMode === 'merged' ? 'white' : 'var(--text-primary)', border: 'none', cursor: 'pointer', borderRadius: '4px' }}>Merged PDF</button>
          </div>
          <button className="btn btn-secondary" disabled={!allReady || status === 'generating' || isUploading} onClick={startGeneration}>
            {status === 'generating' || isUploading ? <div className="spin"><Settings size={18} /></div> : <Play size={18} />} 
            {status === 'generating' ? 'Generating...' : 'Batch Generate'}
          </button>
        </div>
      </header>

      <div className="main-workspace">
        {/* Left Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2><Settings size={18} /> Assets & Configuration</h2>
          </div>
          <div className="sidebar-content">
            
            <label className={`upload-zone ${templateFile ? 'success' : ''}`}>
              <input type="file" accept="image/*" className="hidden-input" onChange={handleTemplateUpload} />
              <ImgIcon className="upload-icon" size={28} />
              <div>
                <div className="upload-label">{templateFile ? 'Template Loaded' : '1. Upload Template'}</div>
                <div className="upload-subtext">{templateFile ? templateFile.name : 'PNG or JPG background'}</div>
              </div>
            </label>

            <label className={`upload-zone ${excelFile ? 'success' : ''}`}>
              <input type="file" accept=".xlsx" className="hidden-input" onChange={handleExcelUpload} />
              <FileSpreadsheet className="upload-icon" size={28} />
              <div>
                <div className="upload-label">{excelFile ? 'Data Loaded' : '2. Upload Data'}</div>
                <div className="upload-subtext">{excelFile ? excelFile.name : '.xlsx spreadsheet'}</div>
              </div>
            </label>

            <label className={`upload-zone ${photos ? 'success' : ''}`}>
              <input type="file" accept="image/*" className="hidden-input" 
                // @ts-ignore
                webkitdirectory="true" directory="true" multiple onChange={handlePhotosUpload} 
              />
              <Folder className="upload-icon" size={28} />
              <div>
                <div className="upload-label">{photos ? `${photos.length} Photos Loaded` : '3. Photos Folder (Optional)'}</div>
                <div className="upload-subtext">{photos ? 'Photo matching enabled' : 'Names must match ID column'}</div>
              </div>
            </label>

            {headers.length > 0 && templateUrl && (
              <div style={{ marginTop: '0.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', marginBottom: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Data Fields</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {headers.map(h => (
                    <button key={h} className="add-element-btn" onClick={() => addTextElement(h)}>
                      <Plus size={14} /> {h}
                    </button>
                  ))}
                </div>

                {config.photo_enabled && (
                  <div className="settings-group" style={{ marginTop: '1.5rem' }}>
                    <label style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                       Match photos to column:
                    </label>
                    <select value={config.photo_column} onChange={e => setConfig({ ...config, photo_column: e.target.value })}>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Main Canvas Area */}
        <main className="canvas-area">
          <div className="canvas-container" ref={containerRef} onClick={() => setActiveElement(null)}>
            {!templateUrl ? (
              <div className="canvas-placeholder">
                <ImgIcon size={64} style={{ opacity: 0.3 }} />
                <p>Upload a template and data file to start designing.</p>
              </div>
            ) : (
              <div
                style={{
                  width: bgSize.width,
                  height: bgSize.height,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                  background: `url(${templateUrl}) no-repeat top left`,
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  marginTop: -(bgSize.height * scale) / 2,
                  marginLeft: -(bgSize.width * scale) / 2,
                  boxShadow: 'var(--shadow-lg)',
                  backgroundColor: 'white'
                }}
              >
                <img src={templateUrl} style={{ display: 'none' }} onLoad={onImageLoad} alt="preload" />

                {/* Photo Element */}
                {config.photo_enabled && (
                  <Rnd
                    scale={scale}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: activeElement === 'PHOTO' ? '3px solid var(--accent-primary)' : '2px dashed var(--accent-primary)',
                      background: 'rgba(99, 102, 241, 0.1)', cursor: 'move',
                    }}
                    bounds="parent"
                    size={{ width: config.photo_w, height: config.photo_h }}
                    position={{ x: config.photo_x, y: config.photo_y }}
                    onMouseDown={(e: any) => { e.stopPropagation(); setActiveElement('PHOTO'); }}
                    onClick={(e: any) => { e.stopPropagation(); setActiveElement('PHOTO'); }}
                    onDragStart={() => setActiveElement('PHOTO')}
                    onDragStop={(e, d) => updateConfigWithHistory(c => ({ ...c, photo_x: d.x, photo_y: d.y }))}
                    onResizeStart={() => setActiveElement('PHOTO')}
                    onResizeStop={(e, dir, ref, delta, pos) => {
                      updateConfigWithHistory(c => ({ ...c, photo_w: parseInt(ref.style.width), photo_h: parseInt(ref.style.height), ...pos }));
                    }}
                  >
                    <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold', fontSize: '24px' }}>PHOTO</span>
                  </Rnd>
                )}

                {/* Text Elements */}
                {config.text_elements.map(el => {
                  const isActive = activeElement === el.id;
                  return (
                    <Rnd
                      scale={scale}
                      key={el.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: isActive ? '2px solid var(--accent-primary)' : '2px dashed rgba(99, 102, 241, 0.4)',
                        background: isActive ? 'rgba(99, 102, 241, 0.05)' : 'transparent',
                        cursor: 'move'
                      }}
                      bounds="parent"
                      enableResizing={{ left: true, right: true, top: false, bottom: false, topLeft: false, topRight: false, bottomLeft: false, bottomRight: false }}
                      size={{ width: el.w, height: el.h }}
                      position={{ x: el.x, y: el.y }}
                      onMouseDown={(e: any) => { e.stopPropagation(); setActiveElement(el.id); }}
                      onClick={(e: any) => { e.stopPropagation(); setActiveElement(el.id); }}
                      onDragStart={(e) => { e.stopPropagation(); setActiveElement(el.id); }}
                      onDragStop={(e, d) => updateTextElement(el.id, { x: d.x, y: d.y })}
                      onResizeStart={(e) => { e.stopPropagation(); setActiveElement(el.id); }}
                      onResizeStop={(e, dir, ref, delta, pos) => {
                        updateTextElement(el.id, { w: parseInt(ref.style.width), ...pos });
                      }}
                    >
                      {isActive && (
                        <div onClick={(e) => removeTextElement(el.id, e)} style={{ position: 'absolute', top: -30, right: 0, background: 'var(--error)', color: 'white', borderRadius: '50%', padding: '4px', cursor: 'pointer', zIndex: 10 }}>
                          <X size={16} />
                        </div>
                      )}

                      <div style={{
                        width: '100%',
                        display: 'flex', justifyContent: 'center', alignItems: 'center',
                        fontSize: `${el.font_size}px`,
                        color: 'black',
                        whiteSpace: 'nowrap',
                        ...getCssForFont(el.font_family)
                      }}>
                        {el.extract_numbers
                          ? (currentPreviewData[el.column] ? String(currentPreviewData[el.column]).replace(/\D/g, '') : `<${el.column}>`)
                          : (currentPreviewData[el.column] || `<${el.column}>`)}
                      </div>

                      {/* Element Settings Context Menu */}
                      {isActive && (
                        <div onClick={e => e.stopPropagation()}
                          onPointerDown={e => e.stopPropagation()}
                          onMouseDown={e => e.stopPropagation()}
                          onTouchStart={e => e.stopPropagation()}
                          style={{
                            position: 'absolute', bottom: '100%', left: '50%',
                            transform: `translate(-50%, -10px) scale(${1 / scale})`,
                            transformOrigin: 'bottom center',
                            background: 'white', border: '1px solid var(--border-light)', borderRadius: '8px',
                            padding: '0.75rem 1rem', display: 'flex', gap: '1rem', zIndex: 1000,
                            boxShadow: 'var(--shadow-lg)', width: 'max-content', alignItems: 'center'
                          }}>
                          <div className="settings-group" style={{ minWidth: '120px' }}>
                            <label>Font Style</label>
                            <select value={el.font_family} onChange={e => updateTextElement(el.id, { font_family: e.target.value })}>
                              {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                            </select>
                          </div>
                          
                          <div className="settings-group" style={{ width: '130px' }}>
                            <label>Size ({el.font_size}px)</label>
                            <input type="range" min="10" max="250" value={el.font_size} onChange={e => updateTextElement(el.id, { font_size: +e.target.value })} style={{ accentColor: 'var(--accent-primary)' }} />
                          </div>

                          <div className="settings-group" style={{ justifyContent: 'center' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', marginTop: '1rem' }}>
                              <input type="checkbox" checked={el.extract_numbers || false} onChange={e => updateTextElement(el.id, { extract_numbers: e.target.checked })} style={{ accentColor: 'var(--accent-primary)' }} />
                              Numbers Only
                            </label>
                          </div>
                        </div>
                      )}
                    </Rnd>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom Pagination / Live Preview Bar */}
          {allRows.length > 0 && templateUrl && status !== 'generating' && status !== 'completed' && (
            <div className="live-preview-bar">
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Live Preview</span>
              <div className="pagination-controls">
                <button className="btn btn-icon-only" onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))} disabled={previewIndex === 0}>
                  <ChevronLeft size={20} />
                </button>
                <span>Record {previewIndex + 1} of {allRows.length}</span>
                <button className="btn btn-icon-only" onClick={() => setPreviewIndex(Math.min(allRows.length - 1, previewIndex + 1))} disabled={previewIndex === allRows.length - 1}>
                  <ChevronRight size={20} />
                </button>
              </div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Use arrow keys to align perfectly</span>
            </div>
          )}
        </main>
      </div>

      {/* Overlays for generating / completed */}
      {(status === 'generating' || status === 'completed') && (
        <div className="status-overlay">
          <div style={{ background: 'white', padding: '3rem', borderRadius: '16px', boxShadow: 'var(--shadow-lg)', maxWidth: '600px', width: '90%', textAlign: 'center' }}>
            {status === 'generating' ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontWeight: 600 }}>
                  <span>Generating Certificates...</span>
                  <span style={{ color: 'var(--accent-primary)' }}>{progress.current} / {progress.total}</span>
                </div>
                <div className="progress-bar-container">
                  <div className="progress-bar-fill" style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}></div>
                </div>
                {progress.skipped > 0 && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Skipped: {progress.skipped} (Files missing properties)
                  </div>
                )}
              </>
            ) : (
              <>
                <CheckCircle2 size={64} style={{ color: 'var(--success)', margin: '0 auto 1.5rem' }} />
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Batch Complete!</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Successfully generated {progress.current} certificates.</p>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                  <button className="btn btn-secondary" onClick={() => setStatus('idle')}>Back to Editor</button>
                  <button className="btn btn-primary" onClick={handleDownload}><Download size={18} /> {downloadMode === 'zip' ? 'Download ZIP' : 'Download Merged PDF'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="status-overlay">
          <div style={{ background: 'white', padding: '3rem', borderRadius: '16px', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--error)', maxWidth: '400px', textAlign: 'center' }}>
            <AlertCircle size={48} color="var(--error)" style={{ margin: '0 auto 1rem' }} />
            <h3 style={{ color: 'var(--error)', marginBottom: '0.5rem', fontSize: '1.25rem' }}>Generation Failed</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>{progress.error_msg}</p>
            <button className="btn btn-primary" style={{ backgroundColor: 'var(--error)' }} onClick={() => setStatus('idle')}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
