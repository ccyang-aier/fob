import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { Editor, Extension } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import * as Y from 'yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import type { FobAuthUser } from '@/features/identity/auth-api';
import type { PageDocumentSession } from '../collaboration/page-provider';
import { createPageUndo } from '../collaboration/page-undo';
import { derivePageEditorView } from './editor-state';
import { insertMedia } from './block-modules/media-core/insert-media';

let browser: Window, host: HTMLDivElement, root: Root;
let Surface: typeof import('./editor-surface').PageEditorSurface;
let currentEditor: Editor | null = null;
let prepared!: () => void;
let preparing = false;
const scope = { knowledgeBaseId: '10000000-0000-4000-8000-000000000001', pageId: '10000000-0000-4000-8000-000000000002' };
const user: FobAuthUser = { id: '10000000-0000-4000-8000-000000000003', name: 'Uploader', email: 'uploader@example.test', emailVerified: true };

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'Event', 'MouseEvent', 'DOMParser', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'Range']) globals[key] = (browser as unknown as Record<string, unknown>)[key];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser);
  globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  mock.module('../navigation/system-navigation', () => ({ useKnowledgeNavigationActive: () => false }));
  mock.module('../profile/use-profile-learning', () => ({ useProfileLearning: () => {} }));
  mock.module('./editor-layout', () => ({
    DocumentEditorFrame: ({ children }: { children: ReactNode }) => children,
    DocumentHeading: () => null,
    DocumentEditorBody: ({ editor }: { editor: Editor | null }) => { currentEditor = editor; return <EditorContent editor={editor} />; },
  }));
  mock.module('./review-integration', () => ({ createPageReviewExtension: () => Extension.create({ name: 'uploadTestReview' }), PageReviewRail: () => null }));
  mock.module('./comments-integration', () => ({ createCommentsEditorExtension: () => Extension.create({ name: 'uploadTestComments' }), PageCommentsLayer: () => null, PageCommentsTrigger: () => null }));
  mock.module('./use-page-metadata', () => ({ usePageMetadata: () => ({ title: 'Upload test', loaded: false }) }));
  mock.module('../navigation/sidebar-collections', () => ({ useSidebarCollections: () => ({ collections: { starred: [] }, toggleStar: () => {} }) }));
  const originalSharing = await import('../sharing/collaboration-api');
  mock.module('../sharing/collaboration-api', () => ({ ...originalSharing, useDocumentSharing: () => ({ data: { people: [] } }), collaborationRequest: async () => ({}), mutationReply: {} }));
  mock.module('../assets/assets-api', () => ({ knowledgeAssetsApi: {
    prepareUpload: async () => { preparing = true; return new Promise(resolve => { prepared = () => resolve({ action: 'reuse' }); }); },
    confirmUpload: async () => ({ created: false, status: 'ready' }),
    download: async () => ({ url: 'https://storage.example/image.png', method: 'GET', expiresAt: new Date(Date.now() + 300_000).toISOString() }),
  } }));
  Surface = (await import('./editor-surface')).PageEditorSurface;
  const { createRoot } = await import('react-dom/client');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
}, 30_000);
afterAll(async () => { await act(async () => root?.unmount()); await browser.happyDOM.abort(); mock.restore(); });

async function settle(check: () => boolean) {
  for (let attempt = 0; attempt < 80 && !check(); attempt++) await act(async () => { await Bun.sleep(10); });
  expect(check()).toBe(true);
}

for (const refreshAt of ['picker', 'upload'] as const) test(`same-user focus refresh during ${refreshAt} preserves the editor and selected image`, async () => {
  await act(async () => root.render(null)); preparing = false;
  const document = new Y.Doc();
  const undo = createPageUndo({ document, bindingOrigins: [ySyncPluginKey] });
  const session = { document, awareness: null, subscribe: () => () => {} } as unknown as PageDocumentSession;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = derivePageEditorView({ status: 'granted', level: 'full' }, null);
  const render = (identity: FobAuthUser) => act(async () => root.render(<QueryClientProvider client={queryClient}><TooltipProvider><Surface
    scope={scope} session={session} origin="http://localhost:8721" user={identity} pageUndo={undo} level="full" view={view}
    folderName="" knowledgeBaseId={scope.knowledgeBaseId} onBack={() => {}} onOpenSidebar={() => {}} onCreateDocument={() => {}} canCreateDocument
  /></TooltipProvider></QueryClientProvider>));
  try {
    await render(user); await settle(() => !!currentEditor && !currentEditor.isDestroyed);
    const original = currentEditor!;
    await act(async () => { expect(insertMedia('image')(original)).toBe(true); });
    const input = window.document.querySelector<HTMLInputElement>('body > input[type=file]')!;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'selected.png', { type: 'image/png' });
    if (refreshAt === 'picker') await render({ ...user });
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => { input.dispatchEvent(new browser.Event('change', { bubbles: true }) as unknown as Event); });
    if (refreshAt === 'upload') { await settle(() => preparing); await render({ ...user }); }
    expect(currentEditor === original).toBe(true);
    expect(original.isDestroyed).toBe(false);
    await settle(() => preparing);
    await act(async () => prepared());
    await settle(() => currentEditor!.state.doc.firstChild?.type.name === 'image' && !!currentEditor!.state.doc.firstChild.attrs.src);
    expect(currentEditor!.state.doc.firstChild!.attrs.alt).toBe('selected.png');
    expect(currentEditor!.state.doc.firstChild!.attrs.src).toStartWith('asset:');
  } finally { await act(async () => root.render(null)); undo.destroy(); document.destroy(); queryClient.clear(); }
});
