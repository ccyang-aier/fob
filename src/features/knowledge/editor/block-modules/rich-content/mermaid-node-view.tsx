'use client';

import { useDeferredValue, useEffect, useId, useState } from 'react';
import Image from 'next/image';
import { useEditorState, type NodeViewProps } from '@tiptap/react';
import { ChartBar, PencilSimple } from '@/components/icons';
import { useTranslation } from '@/lib/i18n';
import { RichBlockFrame } from './rich-block-frame';
import { richMessages } from './messages';
import { useRichTheme } from './use-rich-theme';
import { GraphicToolButton } from './graphic-tool-button';
import { renderMermaid } from './mermaid-runtime';
import { mermaidPalette } from './mermaid-theme';
import styles from './rich-content.module.css';

export function MermaidNodeView(props: NodeViewProps) {
  const { t } = useTranslation(richMessages);
  const dark = useRichTheme();
  const editable = useEditorState({ editor: props.editor, selector: ({ editor }) => editor.isEditable });
  const source = String(props.node.attrs.source || ''), deferred = useDeferredValue(source);
  const [sourceOpen, setSourceOpen] = useState(!source);
  const editing = sourceOpen && editable;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ source: string; dark: boolean; image: string; error: boolean } | null>(null);
  const id = useId().replace(/[^a-z\d]/gi, '');
  useEffect(() => {
    let canceled = false;
    if (!deferred.trim() || editing) return;
    const timer = setTimeout(() => {
      void renderMermaid(`fobDiagram${id}${attempt}`, deferred, dark).then(svg => {
        if (!canceled) setResult({ source: deferred, dark, image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, error: false });
      }).catch(() => { if (!canceled) setResult({ source: deferred, dark, image: '', error: true }); });
    }, 180);
    return () => { canceled = true; clearTimeout(timer); };
  }, [deferred, id, attempt, editing, dark]);
  return <RichBlockFrame props={props} icon={ChartBar} title={t('mermaid')} appearance="canvas" actions={editable && (editing
    ? <GraphicToolButton label={t('preview')} onClick={() => setSourceOpen(false)}><ChartBar size={16} aria-hidden /></GraphicToolButton>
    : <GraphicToolButton label={t('editDiagram')} onClick={() => setSourceOpen(true)}><PencilSimple size={16} aria-hidden /></GraphicToolButton>)}>
    {editing ? <textarea className={styles.source} aria-label={t('mermaidSource')} placeholder={'flowchart LR\n  A[Capture] --> B[Organize] --> C[Reuse]'} value={source} maxLength={50_000} spellCheck={false} onChange={event => { if (props.editor.isEditable) props.updateAttributes({ source: event.target.value }); }} />
      : !source.trim() ? <div className={styles.state}>{t('diagramEmpty')}</div>
      : !result || result.source !== source || result.dark !== dark ? <div className={styles.state} role="status">{t('loading')}</div>
      : result.error ? <div className={styles.state} role="alert">{t('diagramError')}<button type="button" className={`fob-action ${styles.action}`} data-surface="plain" onClick={() => setAttempt(value => value + 1)}>{t('retry')}</button></div>
      : <div className={styles.graphic} style={{ backgroundColor: mermaidPalette(dark).bg }}><Image src={result.image} width={1200} height={800} unoptimized alt={String(props.node.attrs.title || t('mermaid'))} draggable={false} /></div>}
  </RichBlockFrame>;
}
