'use client';
import { useEffect, useMemo } from 'react';
import { useEditor, type Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { useTranslation } from '@/lib/i18n';
import { applyEditorBlockModules } from '../editor/block-modules';
import { DocumentEditorBody, DocumentHeading } from '../editor/editor-layout';
import { useEditorLocale } from '../editor/use-editor-locale';
import type { PageCheckpointPreview } from './history-api';
import { activityMessages } from './activity.messages';
import styles from './history-panel.module.css';

/** A separate read-only editor: viewing history never writes into the live Y.Doc. */
export function VersionDocument({ scope, version, origin, identity, onEditor, onCurrent }: {
  scope: PageScope; version: PageCheckpointPreview; origin: string; identity: string;
  onEditor(id: string, editor: Editor | null): void; onCurrent(): void;
}) {
  const { t, locale } = useTranslation(activityMessages);
  const extensions = useMemo(() => applyEditorBlockModules(createKnowledgeExtensions(), { scope: { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId }, origin, cacheIdentity: identity }), [scope.knowledgeBaseId, scope.pageId, origin, identity]);
  const editor = useEditor({ extensions, content: version.body as JSONContent, editable: false, immediatelyRender: false, autofocus: false,
    editorProps: { attributes: { 'aria-label': t('versions') } } }, [extensions, version.checkpointId]);
  useEditorLocale(editor, locale, t('versions'));
  useEffect(() => { onEditor(version.checkpointId, editor); return () => onEditor(version.checkpointId, null); }, [editor, onEditor, version.checkpointId]);
  const time = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(version.createdAt));
  return <DocumentEditorBody editor={editor} before={<DocumentHeading title={version.title ?? ''} editable={false}
    metadata={<span className={styles.versionNotice}><span>{t('viewingVersion', { time })}</span><button type="button" className="fob-action" onClick={onCurrent}>{t('returnToCurrent')}</button></span>} />} />;
}
