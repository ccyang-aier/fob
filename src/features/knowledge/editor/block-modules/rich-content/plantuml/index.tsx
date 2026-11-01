'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import Image from 'next/image';
import { useEditorState, type NodeViewProps } from '@tiptap/react';
import { ChartBar, PencilSimple } from '@/components/icons';
import { useTranslation } from '@/lib/i18n';
import { RichBlockFrame } from '../frame';
import { richMessages } from '../frame/messages';
import { useRichTheme } from '../frame/use-theme';
import { GraphicToolButton } from '../frame/tool-button';
import { renderPlantUml } from './runtime';
import { PLANTUML_SOURCE_LIMIT } from './source';
import styles from '../frame/styles.module.css';

export function PlantUmlNodeView(props: NodeViewProps) {
  const { t } = useTranslation(richMessages);
  const dark = useRichTheme();
  const editable = useEditorState({ editor: props.editor, selector: ({ editor }) => editor.isEditable });
  const source = String(props.node.attrs.source || '');
  const deferred = useDeferredValue(source);
  const [sourceOpen, setSourceOpen] = useState(!source);
  const editing = sourceOpen && editable;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ source: string; dark: boolean; image: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!deferred.trim() || editing) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void renderPlantUml(deferred, dark, controller.signal).then(svg => {
        if (!controller.signal.aborted) setResult({ source: deferred, dark, image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, error: false });
      }).catch(() => { if (!controller.signal.aborted) setResult({ source: deferred, dark, image: '', error: true }); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [deferred, dark, editing, attempt]);
  const current = result?.source === source && result.dark === dark && !result.error ? result : null;
  return <RichBlockFrame props={props} icon={ChartBar} title={t('plantuml')} appearance="canvas" preview={editing ? undefined : current?.image} intrinsicWidth={editing ? 560 : undefined} fillAvailableWidth={!editing} actions={editable && (editing
    ? <GraphicToolButton label={t('preview')} onClick={() => setSourceOpen(false)}><ChartBar size={16} aria-hidden /></GraphicToolButton>
    : <GraphicToolButton label={t('editDiagram')} onClick={() => setSourceOpen(true)}><PencilSimple size={16} aria-hidden /></GraphicToolButton>)}>
    {editing ? <textarea className={styles.source} aria-label={t('plantumlSource')} placeholder={'@startuml\nAlice -> Bob : Hello\nBob --> Alice : OK\n@enduml'} value={source} maxLength={PLANTUML_SOURCE_LIMIT} spellCheck={false} onChange={event => { if (props.editor.isEditable) props.updateAttributes({ source: event.target.value }); }} />
      : !source.trim() ? <div className={styles.state}>{t('plantumlEmpty')}</div>
      : !result || result.source !== source || result.dark !== dark ? <div className={styles.state} role="status">{t('loading')}</div>
      : result.error ? <div className={styles.state} role="alert">{t('plantumlError')}<button type="button" className={`fob-action ${styles.action}`} data-surface="plain" onClick={() => setAttempt(value => value + 1)}>{t('retry')}</button></div>
      : <div className={styles.graphic}><Image src={result.image} width={1200} height={800} unoptimized alt={String(props.node.attrs.title || t('plantuml'))} draggable={false} /></div>}
  </RichBlockFrame>;
}
