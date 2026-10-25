'use client';
import { usePageVisible } from '@/lib/page-visibility';

import { useUiMessage } from '../ui-message';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './document-tools.messages';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Editor } from '@tiptap/core';
import {
  ArrowsIn,
  ArrowsOut,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  MagnifyingGlass,
  TextAa,
  X,
} from '@/components/icons';
import { DocumentOutline } from './components/document-outline';
import { documentSearchKey, findDocumentMatches } from './extensions/document-search';
import type { DocumentLinkTarget } from './document-link';
import { useDocumentReference } from './document-reference';
import { exportDocumentHtml } from './components/document-html-export';
import { presentationSlides } from './presentation-slides';
import styles from './document-tools.module.css';

type Navigation = {
  onPresent: () => void;
  onSearch: () => void;
  onSplit?: () => void;
  onTogglePin?: () => void;
  pinned: boolean;
  outlineOpen: boolean;
  outlineId: string;
  outlineTrigger: RefObject<HTMLButtonElement | null>;
  onToggleOutline?: () => void;
};
const Context = createContext<Navigation | null>(null);
export const useDocumentNavigation = () => useContext(Context);

function subscribeFullscreen(onChange: () => void) {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
}
const fullscreenSnapshot = () => Boolean(document.fullscreenElement);
const serverFullscreenSnapshot = () => false;

export function DocumentNavigationTools({
  editor,
  title,
  target,
  header,
  sidebar,
  children,
}: {
  editor: Editor | null;
  title: string;
  target: DocumentLinkTarget;
  header: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const reference = useDocumentReference();
  const host = useRef<HTMLDivElement>(null);
  const visible = usePageVisible();
  const documentHost = useRef<HTMLDivElement>(null);
  const outlineTrigger = useRef<HTMLButtonElement>(null);
  const outlineId = useId();
  const [outlinePreference, setOutlineOpen] = useState<boolean | null>(null);
  const [compact, setCompact] = useState(true);
  const outlineOpen = outlinePreference ?? !compact;
  const closeOutline = useCallback(() => setOutlineOpen(false), []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [current, setCurrent] = useState(0);
  const [revision, setRevision] = useState(0);
  const fullscreen = useSyncExternalStore(
    subscribeFullscreen,
    fullscreenSnapshot,
    serverFullscreenSnapshot,
  );
  const input = useRef<HTMLInputElement>(null);
  const presentation = useRef<HTMLDialogElement>(null);
  const [slides, setSlides] = useState<string[]>([]);
  const [slide, setSlide] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [presentError, setPresentError] = useUiMessage(knowledgeMessages, '');
  const [fullscreenError, setFullscreenError] = useUiMessage(knowledgeMessages, '');
  const pending = useRef(0);
  const [activeHeading, setActiveHeading] = useState(-1);
  const headings = useMemo(() => {
    const result: { id: string; pos: number; level: number; title: string }[] = [];
    if (editor)
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading')
          result.push({
            id: node.attrs.blockId as string,
            pos,
            level: node.attrs.level as number,
            title: node.textContent || knowledgeT('untitledSection'),
          });
      });
    return result;
    // Rebuild only when document content changes, never during scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, revision, knowledgeT]);
  useEffect(() => {
    if (!documentHost.current) return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 760));
    observer.observe(documentHost.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!editor) return;
    const update = () => setRevision((value) => value + 1);
    editor.on('update', update);
    return () => {
      editor.off('update', update);
    };
  }, [editor]);
  useEffect(() => {
    const frame = host.current?.closest('[data-knowledge-editor]');
    const scroll = frame?.querySelector('[data-document-scroll]');
    if (!editor?.isInitialized || editor.isDestroyed || !scroll) return;
    let animationFrame = 0;
    const update = () => {
      animationFrame = 0;
      if (editor.isDestroyed || !editor.view.dom.getClientRects().length) return;
      let active = -1;
      const top = scroll.getBoundingClientRect().top + 90;
      headings.forEach((heading, index) => {
        const element = editor.view.nodeDOM(heading.pos);
        if (
          element instanceof HTMLElement &&
          element.isConnected &&
          element.getBoundingClientRect().top <= top
        )
          active = index;
      });
      setActiveHeading(active);
    };
    const schedule = () => {
      if (!animationFrame) animationFrame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(editor.view.dom);
    scroll.addEventListener('scroll', schedule, { passive: true });
    update();
    return () => {
      scroll.removeEventListener('scroll', schedule);
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
    };
  }, [editor, headings]);
  useEffect(() => {
    if (!editor?.isInitialized || editor.isDestroyed) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(documentSearchKey, {
        query: searchOpen ? query : '',
        matchCase,
        current,
      }),
    );
    const active = documentSearchKey.getState(editor.state);
    const match = searchOpen ? active?.matches[active.current] : undefined;
    if (match) {
      const node = editor.view.domAtPos(match.from).node;
      (node instanceof HTMLElement ? node : node.parentElement)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    }
  }, [editor, searchOpen, query, matchCase, current, revision]);
  const matches = editor ? findDocumentMatches(editor.state.doc, query, matchCase) : [];
  function moveMatch(delta: number) {
    if (!editor || !matches.length) return;
    const index = (current + delta + matches.length) % matches.length;
    setCurrent(index);
  }
  function openSearch() {
    setSearchOpen(true);
    requestAnimationFrame(() => input.current?.focus());
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (!visible) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f' &&
        host.current?.closest('[data-knowledge-editor]')?.contains(document.activeElement)
      ) {
        event.preventDefault();
        openSearch();
      }
      if (event.key === 'Escape') setSearchOpen(false);
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [visible]);
  // A hidden tab keeps its pending export; only releasing the page cancels it.
  useEffect(() => () => { pending.current++; }, []);
  async function onPresent() {
    if (!editor) return;
    const request = ++pending.current;
    setPresenting(true);
    setSlides([]);
    setSlide(0);
    setPresentError('');
    presentation.current?.showModal();
    try {
      const html = await exportDocumentHtml(editor, title);
      if (request === pending.current) setSlides(presentationSlides(html, title));
    } catch {
      if (request === pending.current)
        setPresentError({ key: 'unableToGeneratePresentationCloseAndRetry' });
    }
  }
  const closePresentation = () => {
    pending.current++;
    setPresenting(false);
    setSlides([]);
    presentation.current?.close();
  };
  function navigatePresentation(event: { key: string; preventDefault: () => void }) {
    const delta = ['ArrowRight', 'PageDown', ' '].includes(event.key)
      ? 1
      : ['ArrowLeft', 'PageUp'].includes(event.key)
        ? -1
        : 0;
    if (delta) {
      event.preventDefault();
      setSlide((value) => Math.max(0, Math.min(slides.length - 1, value + delta)));
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setSlide(0);
    }
    if (event.key === 'End') {
      event.preventDefault();
      setSlide(Math.max(0, slides.length - 1));
    }
    if (event.key === 'Escape') closePresentation();
  }
  const reportPrimaryDocument = reference?.reportPrimaryDocument;
  const { knowledgeBaseId, pageId, source } = target;
  useEffect(() => {
    reportPrimaryDocument?.({ title, target: { knowledgeBaseId, pageId, source } });
    return () => reportPrimaryDocument?.(null);
  }, [reportPrimaryDocument, title, knowledgeBaseId, pageId, source]);
  return (
    <Context.Provider
      value={{
        onPresent: () => {
          void onPresent();
        },
        onSearch: openSearch,
        onSplit: reference?.openReference
          ? () => reference.openReference!({ target, title })
          : undefined,
        onTogglePin: reference ? () => reference.togglePin({ title, target }) : undefined,
        pinned: reference?.pins.some((pin) => pin.target.pageId === target.pageId) ?? false,
        outlineOpen: Boolean(editor) && outlineOpen,
        outlineId,
        outlineTrigger,
        onToggleOutline: editor ? () => setOutlineOpen(!outlineOpen) : undefined,
      }}
    >
      <div ref={host} className={styles.toolsSurface}>
        <div className={styles.documentPrimary}>
          <div className={styles.toolbarHost}>
            {header}
            {fullscreenError && (
              <div role="alert" className={styles.search}>
                {fullscreenError}
                <button
                  aria-label={knowledgeT('dismissMessage')}
                  onClick={() => setFullscreenError('')}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {searchOpen && (
              <div
                className={`${styles.search} menu-surface`}
                role="search"
                aria-label={knowledgeT('searchDocument')}
              >
                <MagnifyingGlass size={16} />
                <input
                  ref={input}
                  aria-label={knowledgeT('searchTermInDocument')}
                  placeholder={knowledgeT('searchDocument')}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setCurrent(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      moveMatch(event.shiftKey ? -1 : 1);
                    }
                  }}
                />
                <span role="status">
                  {matches.length
                    ? `${Math.min(current + 1, matches.length)}/${matches.length}`
                    : query
                      ? knowledgeT('noResults')
                      : '0/0'}
                </span>
                <button
                  type="button"
                  aria-label={knowledgeT('caseSensitive')}
                  title={knowledgeT('caseSensitive')}
                  aria-pressed={matchCase}
                  onClick={() => {
                    setMatchCase((value) => !value);
                    setCurrent(0);
                  }}
                >
                  <TextAa size={16} />
                </button>
                <button
                  type="button"
                  aria-label={knowledgeT('previousMatch')}
                  disabled={!matches.length}
                  onClick={() => moveMatch(-1)}
                >
                  <CaretUp size={16} />
                </button>
                <button
                  type="button"
                  aria-label={knowledgeT('nextMatch')}
                  disabled={!matches.length}
                  onClick={() => moveMatch(1)}
                >
                  <CaretDown size={16} />
                </button>
                <button
                  type="button"
                  aria-label={knowledgeT('closeDocumentSearch')}
                  onClick={() => setSearchOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </div>
          <div className={styles.surfaceBody}>
            <div ref={documentHost} className={styles.documentSurface}>
              <div
                className={styles.readingSurface}
                data-outline-open={Boolean(editor) && outlineOpen}
              >
                {editor && outlineOpen && (
                  <aside
                    className={styles.readingRail}
                    aria-label={knowledgeT('documentReadingNavigation')}
                  >
                    <div className={styles.railHeader}>
                      <div className={styles.railLabel}>
                        <strong>{knowledgeT('outline')}</strong>
                        <span>{headings.length}</span>
                      </div>
                    </div>
                    <DocumentOutline
                      id={outlineId}
                      headings={headings}
                      activeHeading={activeHeading}
                      onNavigate={(index) => {
                        const element = editor.view.nodeDOM(headings[index].pos);
                        requestAnimationFrame(() => {
                          const scroll = host.current
                            ?.closest('[data-knowledge-editor]')
                            ?.querySelector<HTMLElement>('[data-document-scroll]');
                          if (scroll && element instanceof HTMLElement)
                            scroll.scrollTo({
                              top:
                                scroll.scrollTop +
                                element.getBoundingClientRect().top -
                                scroll.getBoundingClientRect().top -
                                28,
                              behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
                                .matches
                                ? 'instant'
                                : 'smooth',
                            });
                        });
                        setActiveHeading(index);
                      }}
                      onClose={() => {
                        closeOutline();
                        outlineTrigger.current?.focus();
                      }}
                    />
                  </aside>
                )}
                <div className={styles.readingCanvas}>{children}</div>
              </div>
              <footer className={styles.actionBar} aria-label={knowledgeT('documentBottomActions')}>
                <button
                  type="button"
                  className={styles.railButton}
                  aria-label={fullscreen ? knowledgeT('exitFullScreen') : knowledgeT('fullScreen')}
                  title={fullscreen ? knowledgeT('exitFullScreen') : knowledgeT('fullScreen')}
                  aria-pressed={fullscreen}
                  onClick={() => {
                    setFullscreenError('');
                    const request = fullscreen
                      ? document.exitFullscreen()
                      : host.current
                          ?.closest<HTMLElement>('[data-knowledge-editor]')
                          ?.requestFullscreen();
                    void request?.catch(() =>
                      setFullscreenError({ key: 'fullScreenWasDeniedCheckBrowserPermissions' }),
                    );
                  }}
                >
                  {fullscreen ? (
                    <ArrowsIn aria-hidden size={16} />
                  ) : (
                    <ArrowsOut aria-hidden size={16} />
                  )}
                  <span>
                    {fullscreen ? knowledgeT('exitFullScreen') : knowledgeT('fullScreen')}
                  </span>
                </button>
              </footer>
            </div>
          </div>
        </div>
        {sidebar}
        <dialog
          ref={presentation}
          className={styles.presentation}
          aria-label={knowledgeT('documentPresentation')}
          onCancel={closePresentation}
          onKeyDown={navigatePresentation}
        >
          {presenting && (
            <>
              <header>
                <span>{title || knowledgeT('untitledDocument')}</span>
                <button
                  type="button"
                  aria-label={knowledgeT('exitPresentation')}
                  onClick={closePresentation}
                >
                  <X size={16} />
                </button>
              </header>
              <div className={styles.stage}>
                {slides.length ? (
                  <iframe
                    key={slide}
                    title={knowledgeT('presentSlideValue', { v0: slide + 1 })}
                    srcDoc={slides[slide]}
                    sandbox="allow-same-origin"
                    onLoad={(event) => {
                      const document = event.currentTarget.contentDocument;
                      document?.addEventListener('keydown', navigatePresentation);
                      if (document) {
                        document.body.tabIndex = 0;
                        document.body.focus();
                      }
                    }}
                  />
                ) : (
                  <div role={presentError ? 'alert' : 'status'}>
                    {presentError || knowledgeT('preparingPresentation')}
                  </div>
                )}
              </div>
              <footer>
                <button
                  type="button"
                  aria-label={knowledgeT('previousPage')}
                  disabled={slide === 0 || !slides.length}
                  onClick={() => setSlide((value) => value - 1)}
                >
                  <CaretLeft size={16} />
                </button>
                <span>{slides.length ? `${slide + 1} / ${slides.length}` : '…'}</span>
                <button
                  type="button"
                  aria-label={knowledgeT('nextPage')}
                  disabled={slide >= slides.length - 1}
                  onClick={() => setSlide((value) => value + 1)}
                >
                  <CaretRight size={16} />
                </button>
              </footer>
            </>
          )}
        </dialog>
      </div>
    </Context.Provider>
  );
}
