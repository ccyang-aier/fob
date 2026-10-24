'use client';

import { useTranslation, createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './block-reference-picker.messages';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Link, MagnifyingGlass } from '@phosphor-icons/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { fetchReferencePages, type ReferencePageChoice } from '../../../data/reference-pages';
import styles from './block-reference.module.css';

const knowledgeT = createTranslator(knowledgeMessages);

export interface ReferenceBlockChoice {
  id: string;
  label: string;
  type: string;
}

export function listReferenceBlocks(root: ProseMirrorNode): ReferenceBlockChoice[] {
  const blocks: ReferenceBlockChoice[] = [];
  root.descendants((node) => {
    const id = node.attrs.blockId;
    if (typeof id !== 'string' || !id) return;
    const label = node.textContent.trim().slice(0, 100);
    blocks.push({
      id,
      label: label || knowledgeT('emptyValue', { v0: node.type.name }),
      type: node.type.name,
    });
  });
  return blocks;
}

export function BlockReferencePicker({
  knowledgeBaseId,
  excludePageId,
  getLocalPages,
  subscribeLocalPages,
  loadBlocks,
  onChoose,
  onCancel,
}: {
  knowledgeBaseId?: string;
  excludePageId: string;
  getLocalPages?: () => readonly ReferencePageChoice[];
  subscribeLocalPages?: (listener: () => void) => () => void;
  loadBlocks: (scope: PageScope) => Promise<ReferenceBlockChoice[]>;
  onChoose: (scope: PageScope, blockId: string) => void;
  onCancel?: () => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [, setRevision] = useState(0);
  const [remote, setRemote] = useState<{
    knowledgeBaseId: string;
    pages: readonly ReferencePageChoice[];
    failed: boolean;
  }>({ knowledgeBaseId: '', pages: [], failed: false });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReferencePageChoice | null>(null);
  const [blocks, setBlocks] = useState<ReferenceBlockChoice[]>([]);
  const [blockStatus, setBlockStatus] = useState<'idle' | 'loading' | 'failed'>('idle');
  useEffect(
    () => subscribeLocalPages?.(() => setRevision((value) => value + 1)),
    [subscribeLocalPages],
  );
  useEffect(() => {
    if (getLocalPages || !knowledgeBaseId) return;
    const controller = new AbortController();
    fetchReferencePages(controller.signal)
      .then((pages) => {
        if (!controller.signal.aborted) setRemote({ knowledgeBaseId, pages, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setRemote({ knowledgeBaseId, pages: [], failed: true });
      });
    return () => controller.abort();
  }, [getLocalPages, knowledgeBaseId]);
  const pages =
    getLocalPages?.() ?? (remote.knowledgeBaseId === knowledgeBaseId ? remote.pages : []);
  const matches = pages.filter(
    (page) =>
      !(page.id === excludePageId && page.knowledgeBaseId === knowledgeBaseId) &&
      page.title.toLowerCase().includes(query.toLowerCase()),
  );
  const openPage = async (page: ReferencePageChoice) => {
    setSelected(page);
    setBlockStatus('loading');
    setBlocks([]);
    try {
      setBlocks(await loadBlocks({ knowledgeBaseId: page.knowledgeBaseId, pageId: page.id }));
      setBlockStatus('idle');
    } catch {
      setBlockStatus('failed');
    }
  };
  return (
    <div className={styles.picker} contentEditable={false}>
      <div className={styles.pickerHeader}>
        <span className={styles.pickerIcon}>
          <Link aria-hidden size={17} />
        </span>
        <strong>{knowledgeT('referenceDocumentContent')}</strong>
        {onCancel ? (
          <button type="button" onClick={onCancel}>
            {knowledgeT('cancel')}
          </button>
        ) : null}
      </div>
      {selected ? (
        <>
          <button
            type="button"
            className={styles.back}
            onClick={() => {
              setSelected(null);
              setBlocks([]);
            }}
          >
            <ArrowLeft aria-hidden size={15} />
            {selected.title}
          </button>
          <div
            className={styles.options}
            role="listbox"
            aria-label={knowledgeT('chooseReferenceBlock')}
          >
            {blockStatus === 'loading' ? (
              <p>{knowledgeT('readingPageContent')}</p>
            ) : blockStatus === 'failed' ? (
              <p>{knowledgeT('unableToReadChooseThePageAgain')}</p>
            ) : blocks.length ? (
              blocks.map((block) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  key={block.id}
                  onClick={() =>
                    onChoose(
                      { knowledgeBaseId: selected.knowledgeBaseId, pageId: selected.id },
                      block.id,
                    )
                  }
                >
                  <span>
                    <small>{block.type}</small>
                    {block.label}
                  </span>
                  <ArrowRight aria-hidden size={15} />
                </button>
              ))
            ) : (
              <p>{knowledgeT('noContentToReferenceOnThisPageYet')}</p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className={styles.search}>
            <MagnifyingGlass aria-hidden size={15} />
            <input
              aria-label={knowledgeT('searchSourcePages')}
              placeholder={knowledgeT('searchSourcePages2')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div
            className={styles.options}
            role="listbox"
            aria-label={knowledgeT('chooseSourcePage')}
          >
            {!getLocalPages && remote.knowledgeBaseId !== knowledgeBaseId ? (
              <p>{knowledgeT('loadingPages')}</p>
            ) : remote.failed && !getLocalPages ? (
              <p>{knowledgeT('pageListUnavailable')}</p>
            ) : matches.length ? (
              matches.map((page) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  key={`${page.knowledgeBaseId}:${page.id}`}
                  onClick={() => void openPage(page)}
                >
                  <span>
                    {page.knowledgeBaseName ? <small>{page.knowledgeBaseName}</small> : null}
                    {page.title}
                  </span>
                  <ArrowRight aria-hidden size={15} />
                </button>
              ))
            ) : (
              <p>
                {query
                  ? knowledgeT('noMatchingPages')
                  : knowledgeT('noOtherPagesAvailableToReference')}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
