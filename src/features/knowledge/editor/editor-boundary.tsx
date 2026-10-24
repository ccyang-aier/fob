'use client';

import { useLocale } from '@/lib/i18n';
/**
 * The Client Boundary of the page editor (E03).
 *
 * `next/dynamic` with `ssr: false` keeps the whole editor payload — Tiptap,
 * ProseMirror, y-prosemirror and the page session stack — out of both the
 * first-screen bundle and the server render. The chunk streams in only when a
 * page actually opens, with an honest document-shaped loading fallback.
 */

import dynamic from 'next/dynamic';
import { editorClientBoundary } from './editor-boundary-options';

function PageEditorLoading() {
  const locale = useLocale();

  return (
    <div
      role="status"
      aria-label={editorClientBoundary(locale).loadingLabel}
      className="mx-auto w-full max-w-[720px] px-10 py-10"
    >
      <div aria-hidden className="h-[22px] w-[42%] animate-pulse rounded-[6px] bg-[var(--raise)]" />
      <div className="mt-7 space-y-3">
        {[94, 100, 88, 96, 61].map((width, index) => (
          <div
            key={index}
            className="h-[13px] animate-pulse rounded bg-[var(--raise)]"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
      <span className="sr-only">{editorClientBoundary(locale).loadingLabel}</span>
    </div>
  );
}

export const KnowledgePageEditor = dynamic(
  () => import('./page-editor').then((module) => module.PageEditor),
  {
    ssr: editorClientBoundary().ssr,
    loading: PageEditorLoading,
  },
);
