'use client';

import { createTranslator, useTranslation, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './block-reference.messages';

/**
 * The live read-only block reference card (L02, design §4.6).
 *
 * The shared registry owns the `blockReference` atom node (E01); this layer
 * only attaches its browser presentation via `withNodeView` — the schema stays
 * untouched for every other consumer. Each card holds one source-page
 * connection from the refcounted cache (B04 sessions: offline copy first,
 * reconnects free), renders the referenced block's schema-serialized DOM
 * through a path-gated watcher, and derives its state purely. Clicking a live
 * card publishes an open target through the cross-feature channel — the shell
 * wires it to navigation.
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Extensions } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type { Schema } from '@tiptap/pm/model';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import {
  ArrowSquareOut,
  ArrowsClockwise,
  Link,
  Prohibit,
  Trash,
  Warning,
} from '@phosphor-icons/react';
import { withNodeView } from '../../extensions/with-node-view';
import { PAGE_BODY_FRAGMENT } from '../../page-collaboration';
import { requestOpenPageBlock } from '../../open-target';
import { createBlockReferenceSources, watchSourceBlock } from './block-reference-source';
import type {
  BlockReferenceSnapshot,
  BlockReferenceSources,
  BlockReferenceViewState,
  SourceHandle,
} from './block-reference-source';
import { BlockReferencePicker, listReferenceBlocks } from './block-reference-picker';
import { knowledgeErrorCodeOf } from '../../../entry-state';
import type { ReferenceBlockChoice } from './block-reference-picker';

const knowledgeT = createTranslator(knowledgeMessages);

export interface BlockReferenceViewOptions {
  /** The page the editor shows — cyclic references are decided against it. */
  scope: PageScope;
  /** Knowledge API origin from U01, used when no `sources` cache is injected. */
  origin: string;
  cacheIdentity?: string;
  sources?: BlockReferenceSources;
  /** Content reconvert throttle override (tests); default 150ms. */
  throttleMs?: number;
}

/** Per-editor context the addNodeView closure captures. */
interface BlockReferenceEditorContext {
  readonly scope: PageScope;
  readonly sources: BlockReferenceSources;
  readonly throttleMs?: number;
}

const BlockReferenceContext = createContext<BlockReferenceEditorContext | null>(null);

/**
 * Returns the extension list with the registry's `blockReference` node
 * additionally rendering this NodeView. The input list is never mutated.
 */
export function applyBlockReferenceView(
  extensions: Extensions,
  options: BlockReferenceViewOptions,
): Extensions {
  const context: BlockReferenceEditorContext = {
    scope: options.scope,
    sources:
      options.sources ??
      createBlockReferenceSources({ origin: options.origin, cacheIdentity: options.cacheIdentity }),
    throttleMs: options.throttleMs,
  };
  ensureBlockReferenceStyles();
  return withNodeView(extensions, 'blockReference', () =>
    ReactNodeViewRenderer((props: NodeViewProps) => (
      <BlockReferenceContext.Provider value={context}>
        <BlockReferenceCard {...props} />
      </BlockReferenceContext.Provider>
    )),
  );
}

type ReferenceAttrs = {
  knowledgeBaseId: string | null;
  pageId: string | null;
  targetBlockId: string | null;
};

const failedSnapshot: BlockReferenceSnapshot = { state: 'failed', element: null, dom: null };
const loadingSnapshot: BlockReferenceSnapshot = { state: 'loading', element: null, dom: null };

/** States decidable from attrs alone render without ever opening a connection. */
function localViewState(
  attrs: ReferenceAttrs,
  ownScope: PageScope,
): BlockReferenceViewState | null {
  if (attrs.knowledgeBaseId === ownScope.knowledgeBaseId && attrs.pageId === ownScope.pageId)
    return 'cyclic';
  if (!attrs.knowledgeBaseId || !attrs.pageId || !attrs.targetBlockId) return 'unconfigured';
  return null;
}

const accentByState: Record<BlockReferenceViewState, string> = {
  live: 'bg-[var(--accent)]',
  loading: 'bg-[var(--line-strong)]',
  denied: 'bg-[var(--err-ink)]',
  failed: 'bg-[var(--err-ink)]',
  cyclic: 'bg-[var(--warn-ink)]',
  deleted: 'bg-[var(--muted-strong)]',
  unconfigured: 'bg-[var(--line)]',
};

/** The five states rendered as an icon + text notice (never alongside content). */
type BlockReferenceNoticeState = Extract<
  BlockReferenceViewState,
  'denied' | 'failed' | 'deleted' | 'cyclic' | 'unconfigured'
>;

function blockReferenceNotices(
  locale?: Locale,
): Record<BlockReferenceNoticeState, { icon: typeof Link; text: string; tone: string }> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    denied: {
      icon: Prohibit,
      text: knowledgeT('sourcePageAccessDenied'),
      tone: 'text-[var(--err-ink)]',
    },
    failed: {
      icon: Warning,
      text: knowledgeT('unableToConnectToSourcePage'),
      tone: 'text-[var(--err-ink)]',
    },
    deleted: {
      icon: Trash,
      text: knowledgeT('sourceBlockDeleted'),
      tone: 'text-[var(--muted-strong)]',
    },
    cyclic: {
      icon: ArrowsClockwise,
      text: knowledgeT('circularReferenceTheSourceIsThisPage'),
      tone: 'text-[var(--warn-ink)]',
    },
    unconfigured: {
      icon: Link,
      text: knowledgeT('referenceNotConfigured'),
      tone: 'text-[var(--muted-strong)]',
    },
  };
}

function BlockReferenceNotice({ state }: { state: BlockReferenceNoticeState }) {
  const { locale } = useTranslation(knowledgeMessages);

  const { icon: Icon, text, tone } = blockReferenceNotices(locale)[state];
  return (
    <p className={`flex items-center gap-2 py-1 text-[12.5px] ${tone}`}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {text}
    </p>
  );
}

/** Typography for the serialized source block — the page styles, one notch tighter. */
const contentClasses = [
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_p]:my-1 [&_p]:text-[13px] [&_p]:leading-[1.75] [&_p]:text-[var(--ink-soft)]',
  '[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-[18px] [&_h1]:font-semibold [&_h1]:text-[var(--ink)]',
  '[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:text-[var(--ink)]',
  '[&_h3]:mt-2.5 [&_h3]:mb-1 [&_h3]:text-[14.5px] [&_h3]:font-semibold [&_h3]:text-[var(--ink)]',
  '[&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-[13.5px] [&_h4]:font-semibold [&_h4]:text-[var(--ink)]',
  '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5 [&_li>p]:my-0',
  '[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--line-strong)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--muted-strong)]',
  '[&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-[6px] [&_pre]:bg-[var(--surface-subtle)] [&_pre]:p-2.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[11.5px]',
  '[&_code]:font-[var(--font-code)] [&_code]:text-[0.9em] [&_code]:rounded-[4px] [&_code]:bg-[var(--raise)] [&_code]:px-1',
  '[&_strong]:font-semibold [&_strong]:text-[var(--ink)]',
  '[&_em]:italic',
  '[&_a]:text-[var(--accent-ink)] [&_a]:underline [&_a]:underline-offset-2',
  '[&_img]:max-w-full [&_img]:rounded-[6px]',
  '[&_table]:my-1.5 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-[var(--line)] [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-[var(--line)] [&_td]:px-2 [&_td]:py-1',
].join(' ');

const blockReferenceStylesId = 'fob-block-reference-styles';

/** Injects the card's keyframes once per document (no-op on SSR). */
function ensureBlockReferenceStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(blockReferenceStylesId)) return;
  const style = document.createElement('style');
  style.id = blockReferenceStylesId;
  style.textContent = `
@keyframes fob-block-skeleton-shimmer{0%,100%{opacity:.4;}50%{opacity:.85;}}
.ProseMirror .fob-block-skeleton{border-radius:4px;background:var(--raise);animation:fob-block-skeleton-shimmer 1.2s ease-in-out infinite;}
`;
  document.head.append(style);
}

async function loadRemoteBlocks(
  sources: BlockReferenceSources,
  scope: PageScope,
  schema: Schema,
): Promise<ReferenceBlockChoice[]> {
  const handle = await sources.acquire(scope);
  try {
    const fragment = handle.document.getXmlFragment(PAGE_BODY_FRAGMENT);
    const ready = () =>
      handle.status().phase === 'synced' || (handle.status().localReady && fragment.length > 0);
    if (!ready())
      await new Promise<void>((resolve, reject) => {
        let stop = () => {};
        const timer = setTimeout(() => {
          stop();
          reject(new Error(knowledgeT('sourcePageSyncTimedOut')));
        }, 8_000);
        stop = handle.subscribe(() => {
          if (handle.status().phase === 'error') {
            clearTimeout(timer);
            stop();
            reject(new Error(knowledgeT('sourcePageReadingPermissionDenied')));
          } else if (ready()) {
            clearTimeout(timer);
            stop();
            resolve();
          }
        });
        if (ready()) {
          clearTimeout(timer);
          stop();
          resolve();
        }
      });
    return listReferenceBlocks(yXmlFragmentToProseMirrorRootNode(fragment, schema));
  } finally {
    await handle.release();
  }
}

function BlockReferenceCard({ node, editor, updateAttributes }: NodeViewProps) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const context = useContext(BlockReferenceContext);
  const attrs = node.attrs as ReferenceAttrs;
  const knowledgeBaseId = attrs.knowledgeBaseId;
  const pageId = attrs.pageId;
  const targetBlockId = attrs.targetBlockId;
  // Source-backed state arrives only through async events (acquire resolution,
  // session status pushes, throttled watcher notifications) — never a
  // synchronous setState inside an effect.
  const sourceKey = `${knowledgeBaseId}:${pageId}:${targetBlockId}`;
  const [sourceState, setSource] = useState<{ key: string; snapshot: BlockReferenceSnapshot }>(
    () => ({ key: '', snapshot: loadingSnapshot }),
  );
  const source = sourceState.key === sourceKey ? sourceState.snapshot : loadingSnapshot;
  const [editing, setEditing] = useState(false);
  const contentHost = useRef<HTMLDivElement | null>(null);

  const state = (context ? localViewState(attrs, context.scope) : 'unconfigured') ?? source.state;
  const content = (state === 'live' || state === 'loading') && source.dom ? source.dom : null;

  useEffect(() => {
    if (
      !context ||
      !knowledgeBaseId ||
      !pageId ||
      !targetBlockId ||
      (knowledgeBaseId === context.scope.knowledgeBaseId && pageId === context.scope.pageId)
    )
      return undefined;
    let alive = true;
    let stopStatus: (() => void) | undefined;
    let watch: ReturnType<typeof watchSourceBlock> | undefined;
    let handle: SourceHandle | undefined;
    context.sources
      .acquire({ knowledgeBaseId, pageId })
      .then((acquired) => {
        if (!alive) {
          void acquired.release();
          return;
        }
        handle = acquired;
        watch = watchSourceBlock({
          fragment: acquired.document.getXmlFragment(PAGE_BODY_FRAGMENT),
          attrs: { knowledgeBaseId, pageId, targetBlockId },
          ownScope: context.scope,
          status: () => acquired.status(),
          schema: editor.schema,
          throttleMs: context.throttleMs,
        });
        stopStatus = acquired.subscribe(() => watch?.refresh());
        watch.subscribe(() => {
          if (alive && watch) setSource({ key: sourceKey, snapshot: watch.snapshot() });
        });
        setSource({ key: sourceKey, snapshot: watch.snapshot() });
      })
      .catch((cause: unknown) => {
        if (alive)
          setSource({
            key: sourceKey,
            snapshot:
              knowledgeErrorCodeOf(cause) === 'FORBIDDEN'
                ? { state: 'denied', element: null, dom: null }
                : failedSnapshot,
          });
      });
    return () => {
      alive = false;
      stopStatus?.();
      watch?.dispose();
      void handle?.release();
    };
  }, [context, editor.schema, knowledgeBaseId, pageId, targetBlockId, sourceKey]);

  // The serialized subtree is schema-controlled DOM produced by
  // DOMSerializer — painted by replacing children, never injected as HTML text.
  useEffect(() => {
    const host = contentHost.current;
    if (!host) return;
    host.replaceChildren(...(content ? [content] : []));
  }, [content]);

  const open = (): void => {
    if (state !== 'live' || !context || !knowledgeBaseId || !pageId || !targetBlockId) return;
    if (window.getSelection()?.toString()) return;
    requestOpenPageBlock({ knowledgeBaseId, pageId, blockId: targetBlockId });
  };

  if (editor.isEditable && context && (editing || state === 'unconfigured'))
    return (
      <NodeViewWrapper draggable={false} data-block-reference="picker">
        <BlockReferencePicker
          knowledgeBaseId={context.scope.knowledgeBaseId}
          excludePageId={context.scope.pageId}
          loadBlocks={(sourceScope) =>
            loadRemoteBlocks(context.sources, sourceScope, editor.schema)
          }
          onChoose={(sourceScope, blockId) => {
            updateAttributes({ ...sourceScope, targetBlockId: blockId });
            setEditing(false);
          }}
          onCancel={pageId && targetBlockId ? () => setEditing(false) : undefined}
        />
      </NodeViewWrapper>
    );

  return (
    <NodeViewWrapper
      draggable={false}
      contentEditable={false}
      className="my-3 select-none"
      data-block-reference={state}
    >
      <div
        onClick={state === 'live' ? open : undefined}
        onKeyDown={
          state === 'live'
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  open();
                }
              }
            : undefined
        }
        role={state === 'live' ? 'button' : undefined}
        tabIndex={state === 'live' ? 0 : undefined}
        aria-label={
          state === 'live' ? knowledgeT('blockReferenceClickToOpenTheOriginal') : undefined
        }
        className={`group relative flex overflow-hidden rounded-[10px] border bg-[var(--panel)] transition-colors duration-150 ${
          state === 'live'
            ? 'cursor-pointer border-[var(--line)] hover:border-[var(--line-strong)]'
            : 'border-[var(--line)]'
        }`}
      >
        <div aria-hidden className={`w-[3px] shrink-0 ${accentByState[state]}`} />
        <div className="min-w-0 flex-1 px-3.5 py-2.5">
          {content ? (
            <>
              <div key={`source:${sourceKey}`} ref={contentHost} className={contentClasses} />
              {state === 'loading' ? (
                <p className="mt-2 text-[11px] text-[var(--muted)]">
                  {knowledgeT('syncingSourceContent')}
                </p>
              ) : null}
            </>
          ) : state === 'live' || state === 'loading' ? (
            <div
              key="source-loading"
              className="py-1"
              aria-busy="true"
              aria-label={knowledgeT('loadingSourceBlock')}
            >
              <div className="fob-block-skeleton h-[11px] w-[62%]" />
              <div className="fob-block-skeleton mt-1.5 h-[11px] w-[38%]" />
              <p className="mt-2 text-[11.5px] text-[var(--muted)]">
                {knowledgeT('loadingSourceBlock2')}
              </p>
            </div>
          ) : (
            <BlockReferenceNotice state={state} />
          )}
        </div>
        {state === 'live' ? (
          <span className="pointer-events-none absolute right-2.5 top-2.5 flex items-center gap-1 rounded-[6px] border border-[var(--line)] bg-[var(--raise)] px-1.5 py-[3px] text-[11px] font-medium text-[var(--muted-strong)] opacity-0 shadow-[0_1px_4px_rgba(18,23,31,0.12)] transition-opacity duration-150 group-hover:opacity-100">
            <ArrowSquareOut aria-hidden className="size-3" />
            {knowledgeT('goToOriginal')}
          </span>
        ) : null}
        {editor.isEditable ? (
          <button
            type="button"
            aria-label={knowledgeT('changeReference')}
            title={knowledgeT('changeReference')}
            onClick={(event) => {
              event.stopPropagation();
              setEditing(true);
            }}
            className="absolute bottom-2.5 right-2.5 rounded px-1.5 py-1 text-[11px] text-[var(--muted-strong)] opacity-0 hover:bg-[var(--raise)] group-hover:opacity-100 focus-visible:opacity-100"
          >
            {knowledgeT('changeReference')}
          </button>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
