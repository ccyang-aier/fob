'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './editor-layout.messages';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect } from 'react';
import { PageSessionNamespace, usePageScrollKey } from '@/lib/page-session-state';
import { EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import styles from './editor-layout.module.css';
import {
  DocumentAppearanceProvider,
  useDocumentAppearance,
} from './components/document-appearance';
import {
  documentFonts,
  documentCodeFonts,
  documentSizes,
  documentParagraphSpacings,
} from '@/lib/editor-appearance-options';
import './document-fonts.css';
import './code-fonts.css';
import { DocumentNavigationTools } from './document-tools';
import type { DocumentLinkTarget } from './document-link';
import { SelectionToolbar } from './components/selection-toolbar';
import { SlashMenuLayer } from './commands';
import { BlockDragHandle } from './components/block-drag-handle';
import { BlockMenuContext, type BlockEditSource } from './block-menu-context';
import { useBlockMenuContext } from './block-menu-context';
import { useDocumentTab } from './document-tab-context';
import { revealBlockInEditor } from './open-target';
import { isValidBlockId } from '@fob/shared/knowledge/schema';

export function DocumentEditorFrame({
  children,
  header,
  sidebar,
  navigation,
  appearanceScope,
  blockEdits,
}: {
  children: ReactNode;
  header: ReactNode;
  sidebar?: ReactNode;
  navigation: { editor: Editor | null; title: string; target: DocumentLinkTarget };
  appearanceScope: string;
  blockEdits?: BlockEditSource;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <PageSessionNamespace name={`document:${appearanceScope}`}><DocumentAppearanceProvider key={appearanceScope} scope={appearanceScope}><BlockMenuContext value={{ target: navigation.target, ...blockEdits }}>
      <section data-knowledge-editor aria-label={knowledgeT('pageEditor')} className={styles.frame}>
        <DocumentNavigationTools {...navigation} header={header} sidebar={sidebar}>
          {children}
        </DocumentNavigationTools>
      </section>
    </BlockMenuContext></DocumentAppearanceProvider></PageSessionNamespace>
  );
}

export function DocumentHeading({
  title,
  onTitleChange,
  onTitleCommit,
  editable = true,
  metadata,
  icon,
}: {
  title: string;
  onTitleChange?: (title: string) => void;
  onTitleCommit?: () => void;
  editable?: boolean;
  metadata?: ReactNode;
  icon?: ReactNode;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <div className={styles.heading}>
      <div className={styles.titleRow} data-document-heading>
        {icon ? <div className={styles.titleIcon}>{icon}</div> : null}
        {onTitleChange && editable ? (
          <input
            data-knowledge-title
            aria-label={knowledgeT('documentTitle')}
            className={styles.titleInput}
            value={title}
            placeholder={knowledgeT('untitledDocument')}
            maxLength={500}
            onChange={(event) => onTitleChange(event.target.value)}
            onBlur={onTitleCommit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        ) : (
          <h1 className={styles.title}>{title || knowledgeT('untitledDocument')}</h1>
        )}
      </div>
      {metadata ? <div className={styles.metadata}>{metadata}</div> : null}
    </div>
  );
}

export function DocumentEditorBody({
  editor,
  before,
}: {
  editor: Editor | null;
  before?: ReactNode;
}) {
  const scrollKey = usePageScrollKey('editor');
  const { appearance } = useDocumentAppearance();
  const font = documentFonts.find(({ id }) => id === appearance.font)!;
  const codeFont = documentCodeFonts.find(({ id }) => id === appearance.codeFont)!;
  const size = documentSizes.find(({ id }) => id === appearance.size)!;
  const spacing = documentParagraphSpacings.find(({ id }) => id === appearance.paragraphSpacing)!;
  return (
    <div className={styles.scrollArea} data-document-scroll data-page-scroll={scrollKey}>
      <DocumentEditorContent
        editor={editor}
        before={before}
        attributes={{ 'data-width': appearance.width, 'data-font': appearance.font, 'data-size': appearance.size }}
        style={
          {
            '--document-width': `${appearance.width}%`,
            '--document-font': font.family,
            '--document-code-font': codeFont.family,
            '--document-size': `${size.pixels}px`,
            '--document-line-height': appearance.lineHeight,
            '--document-paragraph-gap': `${spacing.pixels}px`,
          } as CSSProperties
        }
      />
    </div>
  );
}

/** Same body, block styles and interaction layers for pages and inline folder overviews. */
export function DocumentEditorContent({ editor, before, style, className, attributes }: { editor: Editor | null; before?: ReactNode; style?: CSSProperties; className?: string; attributes?: Record<string, string | number> }) {
  const context = useBlockMenuContext(), tab = useDocumentTab();
  const search = tab?.search ?? (typeof window === 'undefined' ? '' : window.location.search);
  const { pageId, knowledgeBaseId, source } = context?.target ?? {};
  useEffect(() => {
    if (!editor || !pageId || !knowledgeBaseId || !source) return;
    const params = new URLSearchParams(search), blockId = params.get('block');
    if (!blockId || !isValidBlockId(blockId) || params.get('document') !== pageId || params.get('knowledgeBase') !== knowledgeBaseId || params.get('source') !== source) return;
    let revealed = false;
    const reveal = () => { if (!revealed && !editor.isDestroyed && editor.view.dom.isConnected) revealed = revealBlockInEditor(editor.view, blockId); };
    const frame = requestAnimationFrame(reveal);
    editor.on('update', reveal); editor.on('mount', reveal);
    return () => { cancelAnimationFrame(frame); editor.off('update', reveal); editor.off('mount', reveal); };
  }, [editor, pageId, knowledgeBaseId, source, search]);
  return <><div className={`${styles.document} ${className ?? ''}`} style={style} {...attributes}>{before}<EditorContent editor={editor} /><BlockDragHandle editor={editor} /></div><SelectionToolbar editor={editor} /><SlashMenuLayer editor={editor} /></>;
}
