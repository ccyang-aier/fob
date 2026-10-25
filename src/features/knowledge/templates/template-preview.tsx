'use client';

import { useMemo } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import type { KnowledgeTemplateDetail } from '@fob/shared/knowledge/templates';
import { applyEditorBlockModules } from '../editor/block-modules';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';
import styles from './templates.module.css';

/** The existing schema and block renderers, without a collaboration session or write channel. */
export function TemplatePreview({ detail }: { detail: KnowledgeTemplateDetail }) {
  const { selectedKnowledgeBase: base, principal } = useKnowledgeBaseResources();
  const source = base?.source;
  const { knowledgeBaseId, sourcePageId } = detail.template;
  const extensions = useMemo(() => applyEditorBlockModules(createKnowledgeExtensions(), source === 'local' ? { localKnowledgeBaseId: knowledgeBaseId, localPageId: sourcePageId, cacheIdentity: principal } : { scope: { knowledgeBaseId, pageId: sourcePageId }, cacheIdentity: principal }), [source, knowledgeBaseId, sourcePageId, principal]);
  const editor = useEditor({ extensions, content: detail.document, editable: false, immediatelyRender: false, editorProps: { attributes: { 'aria-label': detail.template.name } } }, [detail, extensions]);
  return <div className={styles.preview} data-template-preview><h2>{detail.template.title || detail.template.name}</h2><EditorContent editor={editor} /></div>;
}
