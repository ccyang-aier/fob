'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { Palette, PencilSimple, DownloadSimple } from '@/components/icons';
import { getOverlayRoot } from '@/lib/overlay-root';
import { useTranslation } from '@/lib/i18n';
import { RichBlockFrame } from './rich-block-frame';
import { richMessages } from './messages';
import { RichContentLoading } from './loading-state';
import { whiteboardSceneHash } from './whiteboard-preview';
import styles from './rich-content.module.css';

const Canvas = dynamic(() => import('./whiteboard-canvas'), { ssr: false, loading: RichContentLoading });

function WhiteboardDialog({ scene, onSave, onClose }: { scene: string; onSave: (value: string, preview: string, previewHash: string) => boolean; onClose: () => void }) {
  const { t } = useTranslation(richMessages);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return createPortal(<dialog className={styles.dialog} ref={dialog} aria-label={t('whiteboard')} onCancel={event => { event.preventDefault(); onClose(); }}>
    <Canvas scene={scene} onSave={onSave} onCancel={onClose} />
  </dialog>, getOverlayRoot() ?? document.body);
}

export function WhiteboardNodeView(props: NodeViewProps) {
  const { t } = useTranslation(richMessages);
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
  const [session, setSession] = useState<{ scene: string } | null>(null);
  const [preview, setPreview] = useState<{ scene: string; image: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!scene || storedPreview || checking) return;
    let canceled = false;
    void import('./whiteboard-runtime').then(module => module.whiteboardImage(scene)).then(image => {
      if (!canceled) setPreview({ scene, image, error: false });
    }).catch(() => { if (!canceled) setPreview({ scene, image: '', error: true }); });
    return () => { canceled = true; };
  }, [scene, storedPreview, checking]);
  const save = (value: string, preview: string, previewHash: string) => {
    if (!props.editor.isEditable || !session) return false;
    const pos = props.getPos();
    if (typeof pos !== 'number') return false;
    const current = props.editor.state.doc.nodeAt(pos);
    if (current?.type.name !== 'whiteboard' || String(current.attrs.scene || '') !== session.scene) return false;
    props.updateAttributes({ scene: value, preview, previewHash }); setSession(null); return true;
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ type: 'excalidraw', version: 2, source: 'Fob', ...JSON.parse(scene) })], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${String(props.node.attrs.title || 'whiteboard')}.excalidraw`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const result = preview?.scene === scene ? preview : null;
  return <>
    <RichBlockFrame props={props} icon={Palette} title={t('whiteboard')} actions={<>
      {scene && <button type="button" className={`fob-action ${styles.iconButton}`} data-surface="plain" title={t('downloadScene')} aria-label={t('downloadScene')} onClick={download}><DownloadSimple size={16} aria-hidden /></button>}
      {props.editor.isEditable && <button type="button" className={`fob-action ${styles.iconButton}`} data-surface="plain" title={t('edit')} aria-label={t('edit')} onClick={() => setSession({ scene })}><PencilSimple size={16} aria-hidden /></button>}
    </>}>
      {storedPreview || result?.image ? <div className={styles.graphic}><Image src={storedPreview || result!.image} width={1200} height={800} unoptimized alt={String(props.node.attrs.title || t('whiteboard'))} onError={() => { if (storedPreview) setFailedSnapshot(storedPreview); }} /></div>
        : result?.error ? <div className={styles.state} role="alert">{t('whiteboardError')}</div>
        : scene && !result ? <div className={styles.state} role="status">{t('loading')}</div>
        : <div className={styles.state}>{props.editor.isEditable ? <button type="button" className={`fob-action ${styles.action}`} data-surface="plain" onClick={() => setSession({ scene })}>{t('whiteboardEmpty')}</button> : t('whiteboard')}</div>}
    </RichBlockFrame>
    {session && <WhiteboardDialog scene={session.scene} onSave={save} onClose={() => setSession(null)} />}
  </>;
}
