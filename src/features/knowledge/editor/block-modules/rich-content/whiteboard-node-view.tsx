'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useEditorState, type NodeViewProps } from '@tiptap/react';
import { Palette, PencilSimple, DownloadSimple } from '@/components/icons';
import { getOverlayRoot } from '@/lib/overlay-root';
import { useTranslation } from '@/lib/i18n';
import { RichBlockFrame } from './rich-block-frame';
import { richMessages } from './messages';
import { RichContentLoading } from './loading-state';
import { whiteboardSceneHash } from './whiteboard-preview';
import styles from './rich-content.module.css';

const Canvas = dynamic(() => import('./whiteboard-canvas'), { ssr: false, loading: RichContentLoading });

function WhiteboardDialog({ scene, title, onSave, onClose }: { scene: string; title: string; onSave: (value: string, preview: string, previewHash: string, title: string) => boolean; onClose: () => void }) {
  const { t } = useTranslation(richMessages);
  const dialog = useRef<HTMLDialogElement>(null);
  const [portalRoot] = useState(() => getOverlayRoot() ?? document.body);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return createPortal(<dialog className={styles.dialog} ref={dialog} aria-label={t('whiteboard')} onCancel={event => { event.preventDefault(); onClose(); }}>
    <Canvas scene={scene} title={title} onSave={onSave} onCancel={onClose} />
  </dialog>, portalRoot);
}

export function WhiteboardNodeView(props: NodeViewProps) {
  const { t } = useTranslation(richMessages);
  const editable = useEditorState({ editor: props.editor, selector: ({ editor }) => editor.isEditable });
  const scene = String(props.node.attrs.scene || '');
  const snapshot = String(props.node.attrs.preview || '');
  const [failedSnapshot, setFailedSnapshot] = useState('');
  const previewHash = String(props.node.attrs.previewHash || '');
  const candidate = snapshot.length <= 8 * 1024 * 1024 && snapshot.startsWith('data:image/png;base64,iVBORw0KGgo') && /^[a-f0-9]{64}$/.test(previewHash) && failedSnapshot !== snapshot;
  const [checked, setChecked] = useState<{ scene: string; hash: string } | null>(null);
  const checking = candidate && checked?.scene !== scene;
  const storedPreview = candidate && checked?.scene === scene && checked.hash === previewHash ? snapshot : '';
  useEffect(() => {
    if (!candidate) return;
    let canceled = false;
    void whiteboardSceneHash(scene).then(hash => { if (!canceled) setChecked({ scene, hash }); }).catch(() => { if (!canceled) setChecked({ scene, hash: '' }); });
    return () => { canceled = true; };
  }, [scene, candidate]);
  const title = String(props.node.attrs.title || '');
  const [session, setSession] = useState<{ scene: string; title: string } | null>(null);
  const activeSession = useRef<typeof session>(null);
  const edit = () => { if (props.editor.isDestroyed || !props.editor.isEditable) return; const next = { scene, title }; activeSession.current = next; setSession(next); };
  const close = () => { activeSession.current = null; setSession(null); };
  useEffect(() => () => { activeSession.current = null; }, []);
  const [preview, setPreview] = useState<{ scene: string; image: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!scene || storedPreview || checking) return;
    let canceled = false;
    void import('./whiteboard-runtime').then(module => module.whiteboardImage(scene)).then(image => {
      if (!canceled) setPreview({ scene, image, error: false });
    }).catch(() => { if (!canceled) setPreview({ scene, image: '', error: true }); });
    return () => { canceled = true; };
  }, [scene, storedPreview, checking]);
  const save = (value: string, preview: string, previewHash: string, nextTitle: string) => {
    if (props.editor.isDestroyed || !props.editor.isEditable || !session || activeSession.current !== session) return false;
    const pos = props.getPos();
    if (typeof pos !== 'number') return false;
    const current = props.editor.state.doc.nodeAt(pos);
    if (current?.type.name !== 'whiteboard' || String(current.attrs.scene || '') !== session.scene || String(current.attrs.title || '') !== session.title) return false;
    props.updateAttributes({ scene: value, preview, previewHash, title: nextTitle }); close(); return true;
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ type: 'excalidraw', version: 2, source: 'Fob', ...JSON.parse(scene) })], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${String(props.node.attrs.title || 'whiteboard')}.excalidraw`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const result = preview?.scene === scene ? preview : null;
  return <>
    <RichBlockFrame props={props} icon={Palette} title={t('whiteboard')} appearance="canvas" actions={<>
      {scene && <button type="button" className={`fob-action ${styles.iconButton}`} data-surface="plain" title={t('downloadScene')} aria-label={t('downloadScene')} onClick={download}><DownloadSimple size={16} aria-hidden /></button>}
      {editable && <button type="button" className={`fob-action ${styles.iconButton}`} data-surface="plain" title={t('editWhiteboard')} aria-label={t('editWhiteboard')} onClick={edit}><PencilSimple size={16} aria-hidden /></button>}
    </>}>
      {storedPreview || result?.image ? <div className={styles.graphic}><Image src={storedPreview || result!.image} width={1200} height={800} unoptimized alt={title || t('whiteboard')} draggable={false} onError={() => { if (storedPreview) setFailedSnapshot(storedPreview); }} /></div>
        : result?.error ? <div className={styles.state} role="alert">{t('whiteboardError')}</div>
        : scene && !result ? <div className={styles.state} role="status">{t('loading')}</div>
        : <div className={styles.state}>{editable ? <button type="button" className={`fob-action ${styles.action}`} data-surface="plain" onClick={edit}>{t('whiteboardEmpty')}</button> : t('whiteboard')}</div>}
    </RichBlockFrame>
    {session && <WhiteboardDialog scene={session.scene} title={session.title} onSave={save} onClose={close} />}
  </>;
}
