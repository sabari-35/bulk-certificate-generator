import React, { useState, useRef, useEffect, SyntheticEvent } from 'react';
import { Upload, FileSpreadsheet, Image as ImageIcon, Folder, Settings, Download, Play, CheckCircle2, AlertCircle, Plus, X, Trash2 } from 'lucide-react';
import { Rnd } from 'react-rnd';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import imageCompression from 'browser-image-compression';
import './index.css';

// Initialize Supabase client
const SUPABASE_URL = 'https://yolgqavimghcmpkqmhdy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvbGdxYXZpbWdoY21wa3FtaGR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMjA2MjIsImV4cCI6MjA4ODU5NjYyMn0.NK6_eoUFYB6Zic5IqevDrdWnbLkmTxY_OwASDBRK60Q'; // Ensure this matches what user provided
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

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
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewData, setPreviewData] = useState<Record<string, string>>({});

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

  // History State for Undo/Redo
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

  // Keyboard Shortcuts Listener
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

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        updateConfigWithHistory(c => ({
          ...c,
          text_elements: c.text_elements.map(el => {
            if (el.id === activeElement) {
              const isBold = el.font_family.includes('bd');
              let newFont = el.font_family;
              if (isBold) newFont = newFont.replace('bd', '');
              else newFont = newFont.replace('.ttf', 'bd.ttf');
              return { ...el, font_family: newFont };
            }
            return el;
          })
        }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeElement]);


  useEffect(() => {
    axios.post(`${API_BASE}/init_session`).then(res => {
      setSessionId(res.data.session_id);
    });
  }, []);

  useEffect(() => {
    if (status === 'generating' && sessionId) {
      const interval = setInterval(async () => {
        try {
          const res = await axios.get(`${API_BASE}/status/${sessionId}`);
          setProgress(res.data);
          if (res.data.status === 'completed' || res.data.status === 'error') {
            setStatus(res.data.status);
            clearInterval(interval);
          }
        } catch (e) {
          console.error(e);
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [status, sessionId]);

  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current && templateUrl) {
        const cw = containerRef.current.clientWidth;
        const ch = containerRef.current.clientHeight;
        const scaleX = cw / bgSize.width;
        const scaleY = ch / bgSize.height;
        setScale(Math.min(scaleX, scaleY, 1));
      }
    };
    window.addEventListener('resize', updateScale);
    updateScale();
    return () => window.removeEventListener('resize', updateScale);
  }, [bgSize, templateUrl]);

  const onImageLoad = (e: SyntheticEvent<HTMLImageElement, Event>) => {
    const img = e.currentTarget;
    setBgSize({ width: img.naturalWidth, height: img.naturalHeight });
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && sessionId) {
      const file = e.target.files[0];
      setExcelFile(file);
      const formData = new FormData();
      formData.append('file', file);
      setIsUploading(true);
      try {
        // 1. Upload Excel to Supabase Storage
        const filePath = `${sessionId}/data.xlsx`;
        const { error: uploadError } = await supabase.storage
          .from('certificates')
          .upload(filePath, file, { upsert: true });

        if (uploadError) throw new Error("Supabase Upload Error: " + uploadError.message);

        // 2. Notify backend to parse the uploaded Excel file
        const res = await axios.post(`${API_BASE}/upload_excel/${sessionId}`, { file_path: filePath });
        setHeaders(res.data.headers);
        setPreviewData(res.data.preview_data);

        // Auto-select photo col if something looks like an ID or matching name
        let pCol = config.photo_column;
        if (!pCol && res.data.headers.length > 0) {
          pCol = res.data.headers.find((h: string) => h.toUpperCase().includes('CERTIFICATE') || h.toUpperCase().includes('ID')) || res.data.headers[0];
          setConfig(prev => ({ ...prev, photo_column: pCol }));
        }
      } catch (err: any) {
        alert("Error: " + (err.response?.data?.error || err.message));
        setExcelFile(null);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && sessionId) {
      let file = e.target.files[0];
      setTemplateUrl(URL.createObjectURL(file));
      setIsUploading(true);

      try {
        const options = {
          maxSizeMB: 1,
          maxWidthOrHeight: 2500,
          useWebWorker: true
        };
        file = await imageCompression(file, options);
        setTemplateFile(file);

        // Upload to Supabase
        const filePath = `${sessionId}/template.png`;
        const { error: uploadError } = await supabase.storage
          .from('certificates')
          .upload(filePath, file, { upsert: true });

        if (uploadError) throw new Error("Supabase Upload Error: " + uploadError.message);

        // Notify Backend
        await axios.post(`${API_BASE}/upload_template/${sessionId}`, { file_path: filePath });
      } catch (err: any) {
        alert("Template Upload Error: " + (err.response?.data?.error || err.message));
        setTemplateFile(null);
        setTemplateUrl(null);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handlePhotosUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && sessionId) {
      setPhotos(e.target.files);
      setConfig(prev => ({ ...prev, photo_enabled: true }));
      setIsUploading(true);

      try {
        const options = {
          maxSizeMB: 0.3,
          maxWidthOrHeight: 800,
          useWebWorker: true
        };

        const filesArray = Array.from(e.target.files);
        // Process and upload in chunks of 20 to avoid payload too large and timeouts
        const CHUNK_SIZE = 20;
        for (let i = 0; i < filesArray.length; i += CHUNK_SIZE) {
          const chunk = filesArray.slice(i, i + CHUNK_SIZE);

          // Compress and Upload in parallel for this chunk
          const uploadPromises = chunk.map(async (f) => {
            const compressed = await imageCompression(f, options);
            const safe_filename = f.name.replace(/\\/g, '/').split('/').pop();
            const filePath = `${sessionId}/photos/${safe_filename}`;

            const { error: uploadError } = await supabase.storage
              .from('certificates')
              .upload(filePath, compressed, { upsert: true });

            if (uploadError) {
              console.error("Failed to upload photo:", f.name, uploadError);
            }
          });

          await Promise.all(uploadPromises);

          // Instead of sending the files, we just let the backend know photos are uploaded later if necessary
          // Or we can just hit an endpoint to register them
          await axios.post(`${API_BASE}/upload_photos/${sessionId}`, { count: chunk.length });
        }
      } catch (err: any) {
        alert("Photos Upload Error: " + (err.response?.data?.error || err.message));
        setPhotos(null);
        setConfig(prev => ({ ...prev, photo_enabled: false }));
      } finally {
        setIsUploading(false);
      }
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
    if (!sessionId) return;
    setStatus('generating');
    try {
      await axios.post(`${API_BASE}/generate/${sessionId}`, config);
    } catch (err: any) {
      setStatus('error');
      setProgress(p => ({ ...p, error_msg: err.response?.data?.error || err.message }));
    }
  };

  const handleDownload = () => {
    if (sessionId) {
      window.open(`${API_BASE}/download/${sessionId}`, '_blank');
    }
  };

  const allReady = excelFile && templateFile;

  return (
    <div className="app-container">
      <header className="header">
        <h1 className="text-gradient">Certificate Studio</h1>
        <p>Fully Dynamic Drag & Drop Certificate Engine</p>
      </header>

      <div className="main-content">
        <div className="glass-panel controls-sidebar" style={{ padding: '2rem' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Settings size={20} className="text-gradient" /> Project Assets
          </h2>

          <label className={`upload-zone glass-panel ${excelFile ? 'success' : ''}`}>
            <input type="file" accept=".xlsx" className="hidden-input" onChange={handleExcelUpload} />
            <FileSpreadsheet className="upload-icon" />
            <div>
              <div className="upload-label">{excelFile ? 'Data Loaded' : 'Upload Data (Excel)'}</div>
              <div className="upload-subtext">{excelFile ? excelFile.name : 'Select your spreadsheet'}</div>
            </div>
          </label>

          <label className={`upload-zone glass-panel ${templateFile ? 'success' : ''}`}>
            <input type="file" accept="image/*" className="hidden-input" onChange={handleTemplateUpload} />
            <ImageIcon className="upload-icon" />
            <div>
              <div className="upload-label">{templateFile ? 'Template Loaded' : 'Upload Template'}</div>
              <div className="upload-subtext">{templateFile ? templateFile.name : 'PNG or JPG background'}</div>
            </div>
          </label>

          <label className={`upload-zone glass-panel ${photos ? 'success' : ''}`}>
            <input type="file" accept="image/*" className="hidden-input"
              // @ts-ignore
              webkitdirectory="true" directory="true" multiple onChange={handlePhotosUpload}
            />
            <Folder className="upload-icon" />
            <div>
              <div className="upload-label">{photos ? `${photos.length} Photos Loaded` : 'Select Photos Folder (Optional)'}</div>
              <div className="upload-subtext">{photos ? 'Photo matching enabled' : 'Names match identifier column'}</div>
            </div>
          </label>

          {/* Dynamic Tools */}
          {headers.length > 0 && templateUrl && (
            <div style={{ marginTop: '1rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Add Elements to Canvas</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {headers.map(h => (
                  <button
                    key={h}
                    onClick={() => addTextElement(h)}
                    style={{
                      background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
                      color: 'white', padding: '0.5rem 1rem', borderRadius: '20px',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
                      fontSize: '0.85rem'
                    }}
                  >
                    <Plus size={14} /> {h}
                  </button>
                ))}
              </div>

              {config.photo_enabled && (
                <div className="settings-panel" style={{ gridTemplateColumns: '1fr', marginTop: '1.5rem', background: 'rgba(0,0,0,0.1)', padding: '1rem', borderRadius: '12px' }}>
                  <div className="settings-group">
                    <label style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>Match photos using this column:</label>
                    <select
                      style={{ padding: '0.5rem', borderRadius: '8px', background: '#111', color: 'white', border: '1px solid var(--glass-border)' }}
                      value={config.photo_column}
                      onChange={e => setConfig({ ...config, photo_column: e.target.value })}
                    >
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 'auto' }}>
            <button className="btn-primary" disabled={!allReady || status === 'generating' || isUploading} onClick={startGeneration}>
              {status === 'generating' || isUploading ? <div className="upload-icon spin" style={{ width: 24, height: 24, color: 'white' }}><Settings /></div> : <Play size={24} />}
              {status === 'generating' ? 'Generating...' : (isUploading ? 'UPLOADING...' : 'START BATCH')}
            </button>
          </div>
        </div>

        <div className="glass-panel preview-workspace" style={{ padding: '0', display: 'flex', flexDirection: 'column' }}>
          <div className="preview-header" style={{ padding: '1.5rem 2rem 1rem' }}>
            <div className="preview-title">Interactive Canvas Designer</div>
            <div style={{ color: 'var(--text-secondary)' }}>Add fields from the sidebar, then drag, resize, and style them here.</div>
          </div>

          <div className="canvas-container" ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', padding: 0 }} onClick={() => setActiveElement(null)}>
            {!templateUrl ? (
              <div className="canvas-placeholder">
                <ImageIcon size={64} style={{ opacity: 0.5 }} />
                <p>Upload a template and excel file to begin designing</p>
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
                  boxShadow: '0 0 50px rgba(0,0,0,0.5)'
                }}
              >
                <img src={templateUrl} style={{ display: 'none' }} onLoad={onImageLoad} alt="preload" />

                {/* Photo Element */}
                {config.photo_enabled && (
                  <Rnd
                    scale={scale}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: activeElement === 'PHOTO' ? '3px solid var(--accent-primary)' : '2px dashed rgba(255, 215, 0, 0.8)',
                      background: 'rgba(0, 0, 0, 0.65)', cursor: 'move',
                      boxShadow: '0 0 15px rgba(0,0,0,0.5) inset'
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
                    <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 'bold', fontSize: '24px' }}>PHOTO AREA</span>
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
                        border: isActive ? '3px solid #ec4899' : '2px dashed rgba(236, 72, 153, 0.5)',
                        background: isActive ? 'rgba(236, 72, 153, 0.15)' : 'transparent',
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
                        <div onClick={(e) => removeTextElement(el.id, e)} style={{ position: 'absolute', top: -30, right: 0, background: 'var(--error)', color: 'white', borderRadius: '50%', padding: '4px', cursor: 'pointer' }}>
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
                          ? (previewData[el.column] ? String(previewData[el.column]).replace(/\D/g, '') : `<${el.column}>`)
                          : (previewData[el.column] || `<${el.column}>`)}
                      </div>

                      {/* Element Settings Context Menu (only shows when active) */}
                      {isActive && (
                        <div onClick={e => e.stopPropagation()}
                          onPointerDown={e => e.stopPropagation()}
                          onMouseDown={e => e.stopPropagation()}
                          onTouchStart={e => e.stopPropagation()}
                          style={{
                            position: 'absolute', bottom: '100%', left: '50%',
                            transform: `translate(-50%, -10px) scale(${1 / scale})`,
                            transformOrigin: 'bottom center',
                            background: '#1e293b', border: '1px solid var(--glass-border)', borderRadius: '12px',
                            padding: '0.75rem 1rem', display: 'flex', gap: '1rem', zIndex: 1000,
                            boxShadow: '0 10px 30px rgba(0,0,0,0.5)', width: 'max-content',
                            alignItems: 'center'
                          }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Font Style</label>
                            <select
                              value={el.font_family} onChange={e => updateTextElement(el.id, { font_family: e.target.value })}
                              style={{ padding: '0.4rem', background: '#0f172a', color: 'white', border: '1px solid var(--glass-border)', borderRadius: '6px', fontSize: '0.85rem' }}
                            >
                              {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                            </select>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', width: '130px' }}>
                            <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Size ({el.font_size}px)</label>
                            <input type="range" min="10" max="250" value={el.font_size} onChange={e => updateTextElement(el.id, { font_size: +e.target.value })} style={{ width: '100%', accentColor: 'var(--accent-primary)' }} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', justifyContent: 'center' }}>
                            <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                              <input type="checkbox" checked={el.extract_numbers || false} onChange={e => updateTextElement(el.id, { extract_numbers: e.target.checked })} style={{ accentColor: 'var(--accent-primary)', width: '14px', height: '14px' }} />
                              Numbers Only
                            </label>
                          </div>

                          <div style={{ height: '30px', width: '1px', background: 'var(--glass-border)', margin: '0 0.5rem' }}></div>

                          <button
                            onClick={(e) => removeTextElement(el.id, e)}
                            style={{
                              background: 'transparent', border: 'none', color: 'var(--error)',
                              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', padding: '0.2rem'
                            }}
                            title="Delete Element"
                          >
                            <Trash2 size={18} />
                            <span style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Delete</span>
                          </button>
                        </div>
                      )}
                    </Rnd>
                  );
                })}

              </div>
            )}
          </div>

          {(status === 'generating' || status === 'completed') && (
            <div className="glass-panel status-section" style={{ position: 'absolute', bottom: '2rem', left: '2rem', right: '2rem', background: 'rgba(15, 23, 42, 0.95)', zIndex: 100 }}>
              {status === 'generating' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 600 }}>Generating Certificates...</span>
                    <span className="text-gradient">{progress.current} / {progress.total}</span>
                  </div>
                  <div className="progress-bar-container">
                    <div className="progress-bar-fill" style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}></div>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Successfully generated... Skipped: {progress.skipped} (Files missing properties)
                  </div>
                </>
              )}
              {status === 'completed' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: 'var(--success)' }}>
                    <CheckCircle2 size={32} />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 600, fontSize: '1.2rem', color: 'white' }}>Batch Complete!</div>
                      <div style={{ color: 'var(--text-secondary)' }}>Generated: {progress.current} | Skipped: {progress.skipped}</div>
                    </div>
                  </div>
                  <button className="btn-primary" style={{ width: 'auto', padding: '1rem 2rem' }} onClick={handleDownload}>
                    <Download size={20} /> Download ZIP
                  </button>
                </div>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="glass-panel status-section" style={{ position: 'absolute', bottom: '2rem', left: '2rem', right: '2rem', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid var(--error)', zIndex: 100 }}>
              <AlertCircle size={32} color="var(--error)" style={{ margin: '0 auto 1rem' }} />
              <h3 style={{ color: 'var(--error)', marginBottom: '0.5rem' }}>Generation Failed</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>{progress.error_msg}</p>
              <button
                className="btn-primary"
                style={{ width: 'auto', padding: '0.5rem 2rem', background: 'var(--error)' }}
                onClick={() => window.location.reload()}
              >
                Start Over
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
