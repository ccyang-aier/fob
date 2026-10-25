'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './local-block-reference.messages';
import { useEffect, useRef, useState } from 'react';
import { ArrowSquareOut, Link, PencilSimple } from '@/components/icons';
import { DOMSerializer } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Extensions } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { withNodeView } from '../../extensions/with-node-view';
import { requestOpenPageBlock } from '../../open-target';
import type { EditorBlockContext } from '../types';
import { BlockReferencePicker, listReferenceBlocks } from './block-reference-picker';
import styles from './block-reference.module.css';

type LocalContext = Required<
  Pick<
    EditorBlockContext,
    'localKnowledgeBaseId' | 'localPageId' | 'getLocalPages' | 'subscribeLocalPages'
  >
>;

export function applyLocalBlockReferenceView(
  extensions: Extensions,
  context: LocalContext,
): Extensions {
  return withNodeView(extensions, 'blockReference', () =>
    ReactNodeViewRenderer((props) => <LocalBlockReferenceCard {...props} context={context} />),
  );
}

function findBlock(root: ProseMirrorNode, id: string): ProseMirrorNode | null {
  let found: ProseMirrorNode | null = null;
  root.descendants((node) => {
    if (!found && node.attrs.blockId === id) found = node;
  });
  return found;
}

function LocalBlockReferenceCard({
  context,
  node,
  editor,
  updateAttributes,
  HTMLAttributes,
}: NodeViewProps & { context: LocalContext }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const contentHost = useRef<HTMLDivElement | null>(null);
  useEffect(() => context.subscribeLocalPages(() => setRevision((value) => value + 1)), [context]);
  const pageId = String(node.attrs.pageId || '');
  const knowledgeBaseId = String(node.attrs.knowledgeBaseId || '');
  const targetBlockId = String(node.attrs.targetBlockId || '');
  const pages = context.getLocalPages();
  const sourcePage = pages.find(
    (page) => page.knowledgeBaseId === knowledgeBaseId && page.id === pageId,
  );
  const cyclic = knowledgeBaseId === context.localKnowledgeBaseId && pageId === context.localPageId;
  let sourceBlock: ProseMirrorNode | null = null;
  if (!cyclic && sourcePage?.body && targetBlockId) {
    try {
      sourceBlock = findBlock(editor.schema.nodeFromJSON(sourcePage.body), targetBlockId);
    } catch {
      /* The source is corrupted; the card displays an explicit unavailable state. */
    }
  }
  useEffect(() => {
    const host = contentHost.current;
    if (!host) return;
    host.replaceChildren(
      ...(sourceBlock ? [DOMSerializer.fromSchema(editor.schema).serializeNode(sourceBlock)] : []),
    );
  }, [sourceBlock, editor.schema, revision]);

  const loadBlocks = async (sourceScope: PageScope) => {
    const source = context
      .getLocalPages()
      .find(
        (page) =>
          page.knowledgeBaseId === sourceScope.knowledgeBaseId && page.id === sourceScope.pageId,
      );
    if (!source?.body) return [];
    return listReferenceBlocks(editor.schema.nodeFromJSON(source.body));
  };
  if (editor.isEditable && (editing || !knowledgeBaseId || !pageId || !targetBlockId))
    return (
      <NodeViewWrapper
        as="div"
        {...HTMLAttributes}
        data-fob-node="block-reference"
        data-block-reference="picker"
      >
        <BlockReferencePicker
          knowledgeBaseId={context.localKnowledgeBaseId}
          excludePageId={context.localPageId}
          getLocalPages={context.getLocalPages}
          subscribeLocalPages={context.subscribeLocalPages}
          loadBlocks={loadBlocks}
          onChoose={(sourceScope, blockId) => {
            updateAttributes({ ...sourceScope, targetBlockId: blockId });
            setEditing(false);
          }}
          onCancel={pageId && targetBlockId ? () => setEditing(false) : undefined}
        />
      </NodeViewWrapper>
    );
  const notice = cyclic
    ? knowledgeT('cannotReferenceTheCurrentPage')
    : !sourcePage
      ? knowledgeT('sourcePageDeletedOrUnavailable')
      : !sourceBlock
        ? knowledgeT('sourceBlockDeleted')
        : '';
  return (
    <NodeViewWrapper
      as="div"
      {...HTMLAttributes}
      data-fob-node="block-reference"
      data-block-reference={notice ? 'unavailable' : 'live'}
      className={styles.localCard}
      contentEditable={false}
    >
      <span className={styles.localAccent} aria-hidden />
      <div className={styles.localBody}>
        <div className={styles.localHeader}>
          <Link aria-hidden size={14} />
          {sourcePage?.title ?? knowledgeT('blockReference')}
        </div>
        {notice ? (
          <span className={styles.localNotice}>{notice}</span>
        ) : (
          <div ref={contentHost} className={styles.localContent} />
        )}
      </div>
      <div className={styles.localActions}>
        {editor.isEditable ? (
          <button
            type="button"
            aria-label={knowledgeT('changeReference')}
            title={knowledgeT('changeReference')}
            onClick={() => setEditing(true)}
          >
            <PencilSimple aria-hidden size={14} />
          </button>
        ) : null}
        {!notice ? (
          <button
            type="button"
            aria-label={knowledgeT('openSourceBlock')}
            title={knowledgeT('openSourceBlock')}
            onClick={() =>
              requestOpenPageBlock({ knowledgeBaseId, pageId, blockId: targetBlockId })
            }
          >
            <ArrowSquareOut aria-hidden size={14} />
          </button>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
