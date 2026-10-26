'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './editor-layout.messages';
import type { CSSProperties, ReactNode } from 'react';
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

export function DocumentEditorFrame({
  children,
  header,
  sidebar,
  navigation,
  appearanceScope,
}: {
  children: ReactNode;
  header: ReactNode;
  sidebar?: ReactNode;
  navigation: { editor: Editor | null; title: string; target: DocumentLinkTarget };
  appearanceScope: string;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <PageSessionNamespace name={`document:${appearanceScope}`}><DocumentAppearanceProvider key={appearanceScope} scope={appearanceScope}>
      <section data-knowledge-editor aria-label={knowledgeT('pageEditor')} className={styles.frame}>
        <DocumentNavigationTools {...navigation} header={header} sidebar={sidebar}>
          {children}
        </DocumentNavigationTools>
      </section>
    </DocumentAppearanceProvider></PageSessionNamespace>
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
      <div className={styles.titleRow}>
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
  return <><div className={`${styles.document} ${className ?? ''}`} style={style} {...attributes}>{before}<EditorContent editor={editor} /><BlockDragHandle editor={editor} /></div><SelectionToolbar editor={editor} /><SlashMenuLayer editor={editor} /></>;
}
