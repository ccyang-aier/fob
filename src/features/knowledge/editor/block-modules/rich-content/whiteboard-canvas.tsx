'use client';

import { useEffect, useRef, useState } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { parseWhiteboardScene } from '@fob/shared/knowledge/rich-content';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { loadWhiteboardLibrary, whiteboardData } from './whiteboard-runtime';
import { richMessages } from './messages';
import { useRichTheme } from './use-rich-theme';
import { whiteboardSceneHash } from './whiteboard-preview';
import styles from './rich-content.module.css';
import '@excalidraw/excalidraw/index.css';

export default function WhiteboardCanvas({ scene, onSave, onCancel }: { scene: string; onSave: (value: string, preview: string, previewHash: string) => boolean; onCancel: () => void }) {
  const { locale, t } = useTranslation(richMessages);
  const dark = useRichTheme();
  const [library, setLibrary] = useState<Awaited<ReturnType<typeof loadWhiteboardLibrary>> | null>(null);
  const [error, setError] = useState<'whiteboardError' | 'whiteboardLimit' | 'whiteboardConflict' | 'whiteboardSaveError' | null>(null);
  const [saving, setSaving] = useState(false);
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const [initial] = useState(() => { try { return whiteboardData(scene); } catch { return null; } });
  useEffect(() => {
    let canceled = false;
    void loadWhiteboardLibrary().then(module => { if (!canceled) setLibrary(module); }).catch(() => { if (!canceled) setError('whiteboardError'); });
    return () => { canceled = true; };
  }, []);
  const save = async () => {
    if (!api.current || !library || saving || !initial) return;
    setSaving(true); setError(null);
    let clean: string;
    try {
      const value = library.serializeAsJSON(api.current.getSceneElements(), api.current.getAppState(), api.current.getFiles(), 'local');
      clean = JSON.stringify(parseWhiteboardScene(value));
    } catch { setError('whiteboardLimit'); setSaving(false); return; }
    try {
      const hash = await whiteboardSceneHash(clean);
      if (!api.current.getSceneElements().length) { if (!onSave(clean, '', '')) setError('whiteboardConflict'); return; }
      const blob = await library.exportToBlob({ elements: api.current.getSceneElements(), files: api.current.getFiles(), appState: { ...api.current.getAppState(), exportBackground: true, exportEmbedScene: false }, mimeType: 'image/png', maxWidthOrHeight: 1024 });
      const preview = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('PREVIEW_UNAVAILABLE')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
      if (!onSave(clean, preview, hash)) setError('whiteboardConflict');
    } catch { setError('whiteboardSaveError'); }
    finally { setSaving(false); }
  };
  const Canvas = library?.Excalidraw, Menu = library?.MainMenu;
  return <>
    <div className={styles.dialogHeader}><strong>{t('whiteboard')}</strong><div className={styles.actions}><Button variant="ghost" size="sm" onClick={onCancel}>{t('cancel')}</Button><Button size="sm" onClick={() => void save()} loading={saving} disabled={!library}>{t('save')}</Button></div></div>
    {(error || !initial) && <div className={styles.error} role="alert">{t(error || 'whiteboardError')}</div>}
    <div className={styles.canvas} inert={saving} aria-busy={saving}>
      {Canvas && Menu && initial ? <Canvas initialData={{ ...initial, scrollToContent: true }} excalidrawAPI={value => { api.current = value; }} langCode={locale.startsWith('zh') ? 'zh-CN' : 'en'} theme={dark ? 'dark' : 'light'} handleKeyboardGlobally={false} autoFocus UIOptions={{ canvasActions: { saveToActiveFile: false, toggleTheme: false, export: { saveFileToDisk: true } } }}
        onLinkOpen={(element, event) => { if (element.link && !/^https?:\/\//i.test(element.link)) event.preventDefault(); }}>
        <Menu><Menu.DefaultItems.LoadScene /><Menu.DefaultItems.Export /><Menu.DefaultItems.ClearCanvas /></Menu>
      </Canvas> : !error && <div className={styles.state} role="status">{t('loading')}</div>}
    </div>
  </>;
}
