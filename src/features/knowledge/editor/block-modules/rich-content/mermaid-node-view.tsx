'use client';

import { useDeferredValue, useEffect, useId, useState } from 'react';
import Image from 'next/image';
import type { NodeViewProps } from '@tiptap/react';
import { ChartBar } from '@/components/icons';
import { useTranslation } from '@/lib/i18n';
import { RichBlockFrame } from './rich-block-frame';
import { richMessages } from './messages';
import { useRichTheme } from './use-rich-theme';
import styles from './rich-content.module.css';

let engine: Promise<typeof import('mermaid')> | undefined;
function mermaidEngine() {
  return engine ??= import('mermaid').then(module => {
    return module;
  }).catch(cause => { engine = undefined; throw cause; });
}

export function MermaidNodeView(props: NodeViewProps) {
  const { t } = useTranslation(richMessages);
  const dark = useRichTheme();
  const source = String(props.node.attrs.source || ''), deferred = useDeferredValue(source);
  const [editing, setEditing] = useState(!source);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ source: string; dark: boolean; image: string; error: boolean } | null>(null);
  const id = useId().replace(/[^a-z\d]/gi, '');
  useEffect(() => {
    let canceled = false;
    if (!deferred.trim() || editing) return;
    const timer = setTimeout(() => {
      void mermaidEngine().then(module => {
        module.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', htmlLabels: false, suppressErrorRendering: true, maxTextSize: 50_000 });
        return module.default.render(`fobDiagram${id}${attempt}`, deferred);
      }).then(rendered => {
        if (!canceled) setResult({ source: deferred, dark, image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered.svg)}`, error: false });
      }).catch(() => { if (!canceled) setResult({ source: deferred, dark, image: '', error: true }); });
    }, 180);
    return () => { canceled = true; clearTimeout(timer); };
  }, [deferred, id, attempt, editing, dark]);
  return <RichBlockFrame props={props} icon={ChartBar} title={t('mermaid')} actions={props.editor.isEditable && <>
    <button type="button" className={`fob-action ${styles.action}`} data-surface="plain" aria-pressed={editing} onClick={() => setEditing(true)}>{t('source')}</button>
    <button type="button" className={`fob-action ${styles.action}`} data-surface="plain" aria-pressed={!editing} onClick={() => setEditing(false)}>{t('preview')}</button>
  </>}>
    {editing && props.editor.isEditable ? <textarea className={styles.source} aria-label={t('mermaidSource')} placeholder={'flowchart LR\n  A[Capture] --> B[Organize] --> C[Reuse]'} value={source} maxLength={50_000} spellCheck={false} onChange={event => props.updateAttributes({ source: event.target.value })} />
      : !source.trim() ? <div className={styles.state}>{t('diagramEmpty')}</div>
      : !result || result.source !== source || result.dark !== dark ? <div className={styles.state} role="status">{t('loading')}</div>
      : result.error ? <div className={styles.state} role="alert">{t('diagramError')}<button type="button" className={`fob-action ${styles.action}`} data-surface="plain" onClick={() => setAttempt(value => value + 1)}>{t('retry')}</button></div>
      : <div className={`${styles.graphic} ${styles.diagram}`}><Image src={result.image} width={1200} height={800} unoptimized alt={String(props.node.attrs.title || t('mermaid'))} /></div>}
  </RichBlockFrame>;
}
