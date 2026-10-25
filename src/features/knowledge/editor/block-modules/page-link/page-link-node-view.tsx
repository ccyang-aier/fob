'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './page-link-node-view.messages';
import { useEffect, useState } from 'react';
import { ArrowRight, FileText, MagnifyingGlass, PencilSimple } from '@phosphor-icons/react';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import { fetchReferencePages, type ReferencePageChoice } from '../../../data/reference-pages';
import { requestOpenPageBlock } from '../../open-target';
import styles from './page-link.module.css';

export function PageLinkNodeView({
  knowledgeBaseId,
  getLocalPages,
  ...props
}: NodeViewProps & {
  knowledgeBaseId?: string;
  getLocalPages?: () => readonly ReferencePageChoice[];
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const { node, editor, updateAttributes, HTMLAttributes } = props;
  const pageId = String(node.attrs.pageId || '');
  const targetKnowledgeBaseId = String(node.attrs.knowledgeBaseId || '');
  const title = String(node.attrs.title || knowledgeT('pageLink'));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<{
    knowledgeBaseId: string;
    pages: readonly ReferencePageChoice[];
    status: 'idle' | 'failed';
  }>({ knowledgeBaseId: '', pages: [], status: 'idle' });
  const selecting = open || !pageId || !targetKnowledgeBaseId;

  useEffect(() => {
    if (!selecting || getLocalPages || !knowledgeBaseId) return;
    const controller = new AbortController();
    fetchReferencePages(controller.signal)
      .then((pages) => {
        if (!controller.signal.aborted) setRemote({ knowledgeBaseId, pages, status: 'idle' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setRemote({ knowledgeBaseId, pages: [], status: 'failed' });
      });
    return () => controller.abort();
  }, [selecting, knowledgeBaseId, getLocalPages]);

  const pages =
    getLocalPages?.() ?? (remote.knowledgeBaseId === knowledgeBaseId ? remote.pages : []);
  const status = getLocalPages
    ? 'idle'
    : remote.knowledgeBaseId === knowledgeBaseId
      ? remote.status
      : 'loading';
  const matches = pages
    .filter((page) => page.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 30);

  return (
    <NodeViewWrapper
      as="div"
      {...HTMLAttributes}
      data-fob-node="page-link"
      data-block-id={node.attrs.blockId}
      className={styles.root}
    >
      {pageId && targetKnowledgeBaseId && !open ? (
        <div className={styles.card} contentEditable={false}>
          <span className={styles.icon}>
            <FileText aria-hidden size={20} weight="regular" />
          </span>
          <span className={styles.cardText}>
            <strong>{title}</strong>
            <small>{knowledgeT('knowledgeBasePage')}</small>
          </span>
          {editor.isEditable ? (
            <button
              type="button"
              className={styles.edit}
              title={knowledgeT('changePage')}
              aria-label={knowledgeT('changePage')}
              onClick={() => setOpen(true)}
            >
              <PencilSimple aria-hidden size={16} />
            </button>
          ) : null}
          <button
            type="button"
            className={styles.open}
            title={knowledgeT('openPage')}
            aria-label={knowledgeT('openValue', { v0: title })}
            onClick={() => requestOpenPageBlock({ knowledgeBaseId: targetKnowledgeBaseId, pageId })}
          >
            <ArrowRight aria-hidden size={17} />
          </button>
        </div>
      ) : editor.isEditable ? (
        <div className={styles.picker} contentEditable={false}>
          <div className={styles.pickerTitle}>
            <FileText aria-hidden size={17} />
            {knowledgeT('chooseAnAccessiblePage')}
          </div>
          <div className={styles.search}>
            <MagnifyingGlass aria-hidden size={16} />
            <input
              autoFocus
              aria-label={knowledgeT('searchPages')}
              placeholder={knowledgeT('searchPageNames')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className={styles.results} role="listbox" aria-label={knowledgeT('pagePicker')}>
            {status === 'loading' ? (
              <p>{knowledgeT('loadingPages')}</p>
            ) : status === 'failed' ? (
              <p>{knowledgeT('pageListUnavailableRetryLater')}</p>
            ) : matches.length ? (
              matches.map((page) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={
                    page.id === pageId && page.knowledgeBaseId === targetKnowledgeBaseId
                  }
                  key={`${page.knowledgeBaseId}:${page.id}`}
                  onClick={() => {
                    updateAttributes({
                      knowledgeBaseId: page.knowledgeBaseId,
                      pageId: page.id,
                      title: page.title,
                    });
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <FileText aria-hidden size={15} />
                  <span>{page.title}</span>
                  {page.knowledgeBaseName ? <small>{page.knowledgeBaseName}</small> : null}
                </button>
              ))
            ) : (
              <p>{query ? knowledgeT('noMatchingPages') : knowledgeT('noAccessiblePages')}</p>
            )}
          </div>
          {pageId ? (
            <button type="button" className={styles.cancel} onClick={() => setOpen(false)}>
              {knowledgeT('cancel')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className={styles.unconfigured} contentEditable={false}>
          {knowledgeT('noPageSelected')}
        </div>
      )}
    </NodeViewWrapper>
  );
}
