'use client';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './file-document-surface.messages';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Page, PdfCommentAnchor } from '@fob/shared/knowledge/contracts';
import { PageComments, type PdfCommentBridge } from '../comments/comments-controller';
import { usePageCommentThreads } from '../comments/comments-queries';
import { PageCommentsTrigger } from '../editor/comments-integration';
import { useDocumentReference } from '../editor/document-reference';
import type { PdfComments } from './pdf-file-view';
import { DocumentEditorFrame } from '../editor/editor-layout';
import { DocumentEditorHeader } from '../editor/components/document-editor-header';
import { useSidebarCollections } from '../navigation/sidebar-collections';
import { useIdentity } from '@/features/identity/identity-provider';
import { FileDocumentPreview } from './file-document-preview';
import { AssetUploader } from '../assets/components/asset-uploader';
import type { UploadedAsset } from '../assets/use-asset-uploads';
import {
  fileFromProperties,
  fileProperties,
  documentFileFormat,
  type DocumentFile,
} from './file-format';
import { updateKnowledgePage, recycleKnowledgePage } from '../data/pages-api';
import { knowledgeQueryKeys } from '../data/query-keys';
import type { LocalDocument } from '../local/local-library';

type SurfaceProps = {
  knowledgeBaseId: string;
  folderName: string;
  onBack: () => void;
  onOpenSidebar: () => void;
  onCreateDocument: () => void;
};
export function KnowledgeBaseFileDocument({
  knowledgeBaseId,
  page,
  canEdit,
  canComment,
  avatarName,
  folderName,
  onBack,
  onOpenSidebar,
  onCreateDocument,
}: SurfaceProps & { page: Page; canEdit: boolean; canComment: boolean; avatarName: string }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const client = useQueryClient();
  const { session } = useIdentity();
  const { collections, toggleStar } = useSidebarCollections(
    session.status === 'authenticated' ? session.user.id : 'guest',
    knowledgeBaseId,
  );
  const [associate, setAssociate] = useState(false);
  const [error, setError] = useState('');
  const file = useMemo(() => fileFromProperties(page.properties), [page.properties]);
  const pdf = file && documentFileFormat(file.name) === 'pdf';
  const [thumbnails, setThumbnails] = useState(false);
  const thumbnailsId = useId();
  const reference = useDocumentReference();
  const [railOpen, setRailOpen] = useState(false),
    [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const composer = useRef<Parameters<PdfCommentBridge['bindCompose']>[0] | null>(null);
  const bindCompose = useCallback<PdfCommentBridge['bindCompose']>((handler) => {
    composer.current = handler;
    return () => {
      composer.current = null;
    };
  }, []);
  const [locate, setLocate] = useState<PdfComments['locate']>(null);
  const scope = { knowledgeBaseId, pageId: page.id };
  const threads = usePageCommentThreads(pdf ? knowledgeBaseId : null, pdf ? page.id : null);
  const selectThread = (id: string) => {
    setActiveThreadId(id);
    setRailOpen(true);
  };
  const locateAnchor = (anchor: PdfCommentAnchor) =>
    setLocate((previous) => ({ anchor, sequence: (previous?.sequence ?? 0) + 1 }));
  const comments: PdfComments | undefined = pdf
    ? {
        assetHash: file.source.slice(6),
        canComment,
        activeThreadId,
        onSelect: selectThread,
        onCompose: (selection) => composer.current?.(selection),
        locate,
        highlights: (threads.data ?? [])
          .filter((thread) => thread.pdfAnchor?.assetHash === file.source.slice(6))
          .map((thread) => ({
            id: thread.id,
            anchor: thread.pdfAnchor!,
            count: thread.comments.length,
            resolved: thread.status === 'resolved',
          })),
      }
    : undefined;
  const bridge: PdfCommentBridge | undefined = pdf
    ? {
        assetHash: file.source.slice(6),
        bindCompose,
        onLocate: locateAnchor,
        activeThreadId,
        onSelectThread: selectThread,
      }
    : undefined;
  async function uploaded(asset: UploadedAsset) {
    setError('');
    try {
      const uploadedFile = {
        source: `asset:${asset.hash}`,
        name: asset.name,
        mime: asset.mime,
        size: asset.size,
      };
      if (!documentFileFormat(asset.name))
        throw new Error(knowledgeT('chooseASupportedPreviewFormat'));
      const updated = await updateKnowledgePage(knowledgeBaseId, {
        pageId: page.id,
        properties: { ...page.properties, ...fileProperties(uploadedFile) },
      });
      client.setQueryData<Page[]>(knowledgeQueryKeys.pages(knowledgeBaseId), (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item)),
      );
      setAssociate(false);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : knowledgeT('unableToAttachFilePleaseRetry'),
      );
    }
  }
  return (
    <DocumentEditorFrame
      appearanceScope={`file:${knowledgeBaseId}:${page.id}`}
      sidebar={
        pdf ? (
          <PageComments
            scope={scope}
            knowledgeBaseId={knowledgeBaseId}
            editor={null}
            pdf={bridge}
            canComment={canComment}
            currentUser={session.status === 'authenticated' ? session.user : null}
            railOpen={railOpen}
            onRailOpenChange={setRailOpen}
            followDocumentLink={!reference?.fixed}
          />
        ) : undefined
      }
      navigation={{
        editor: null,
        title: page.title,
        target: { knowledgeBaseId, pageId: page.id, source: 'server' },
      }}
      header={
        <DocumentEditorHeader
          pdfNavigation={
            pdf
              ? {
                  open: thumbnails,
                  id: thumbnailsId,
                  onToggle: () => setThumbnails((value) => !value),
                }
              : undefined
          }
          editor={null}
          folderName={folderName}
          title={page.title}
          avatarName={avatarName}
          starred={collections.starred.includes(page.id)}
          onOpenSidebar={onOpenSidebar}
          onToggleStar={() => toggleStar(page.id)}
          canCreateDocument={canEdit}
          onCreateDocument={onCreateDocument}
          shareDescription={knowledgeT('theOriginalFileUsesThisKnowledgeBaseS')}
          menuActions={{
            onComments: pdf ? () => setRailOpen((value) => !value) : undefined,
            target: { knowledgeBaseId, pageId: page.id, source: 'server' },
            onDelete: canEdit
              ? async () => {
                  await recycleKnowledgePage(knowledgeBaseId, { pageId: page.id });
                  void client.invalidateQueries({
                    queryKey: knowledgeQueryKeys.pages(knowledgeBaseId),
                  });
                  onBack();
                }
              : undefined,
          }}
        />
      }
    >
      <FileDocumentPreview
        thumbnails={thumbnails}
        thumbnailsId={thumbnailsId}
        onThumbnailsChange={setThumbnails}
        knowledgeBaseId={knowledgeBaseId}
        source="server"
        file={file}
        name={page.title}
        pdfComments={comments}
        commentTrigger={
          pdf ? (
            <PageCommentsTrigger
              scope={scope}
              open={railOpen}
              onToggle={() => setRailOpen((value) => !value)}
            />
          ) : undefined
        }
        attach={
          canEdit ? (
            <button type="button" onClick={() => setAssociate(true)}>
              {knowledgeT('chooseOriginalFile')}
            </button>
          ) : undefined
        }
      />
      {associate && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--panel)] p-8">
          <div className="w-full max-w-[440px]">
            <div className="mb-5 flex justify-between text-sm">
              <strong>{knowledgeT('attachOriginalFile')}</strong>
              <button
                aria-label={knowledgeT('closeFileAttachment')}
                onClick={() => setAssociate(false)}
              >
                {knowledgeT('close')}
              </button>
            </div>
            <AssetUploader
              knowledgeBaseId={knowledgeBaseId}
              onUploaded={(asset) => {
                void uploaded(asset);
              }}
            />
            {error && (
              <p role="alert" className="mt-4 text-xs text-[var(--err-ink)]">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </DocumentEditorFrame>
  );
}

export function LocalFileDocument({
  knowledgeBaseId,
  document,
  folderName,
  onBack,
  onOpenSidebar,
  onCreateDocument,
  onChange,
  attach,
}: SurfaceProps & {
  document: LocalDocument;
  onChange: (patch: Partial<LocalDocument>) => boolean;
  attach: (setFile: (file: DocumentFile) => boolean) => React.ReactNode;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [associate, setAssociate] = useState(false);
  const [thumbnails, setThumbnails] = useState(false);
  const thumbnailsId = useId();
  const pdf = documentFileFormat(document.file?.name ?? document.title) === 'pdf';
  return (
    <DocumentEditorFrame
      appearanceScope={`local-file:${knowledgeBaseId}:${document.id}`}
      navigation={{
        editor: null,
        title: document.title,
        target: { knowledgeBaseId: document.baseId, pageId: document.id, source: 'local' },
      }}
      header={
        <DocumentEditorHeader
          pdfNavigation={
            pdf
              ? {
                  open: thumbnails,
                  id: thumbnailsId,
                  onToggle: () => setThumbnails((value) => !value),
                }
              : undefined
          }
          editor={null}
          folderName={folderName}
          title={document.title}
          avatarName={knowledgeT('me')}
          starred={document.starred}
          onOpenSidebar={onOpenSidebar}
          onToggleStar={() => onChange({ starred: !document.starred })}
          onCreateDocument={onCreateDocument}
          shareDescription={knowledgeT('theOriginalFileIsStoredOnlyInThis')}
          menuActions={{
            target: { knowledgeBaseId: document.baseId, pageId: document.id, source: 'local' },
            onDelete: () => {
              if (onChange({ deleted: true })) onBack();
              else throw new Error(knowledgeT('unableToSave'));
            },
          }}
        />
      }
    >
      <FileDocumentPreview
        thumbnails={thumbnails}
        thumbnailsId={thumbnailsId}
        onThumbnailsChange={setThumbnails}
        knowledgeBaseId={knowledgeBaseId}
        source="local"
        file={document.file}
        name={document.title}
        attach={
          <button type="button" onClick={() => setAssociate(true)}>
            {knowledgeT('chooseOriginalFile')}
          </button>
        }
      />
      {associate && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--panel)] p-8">
          <div className="w-full max-w-[440px]">
            <div className="mb-5 flex justify-between text-sm">
              <strong>{knowledgeT('attachOriginalFile')}</strong>
              <button
                aria-label={knowledgeT('closeFileAttachment')}
                onClick={() => setAssociate(false)}
              >
                {knowledgeT('close')}
              </button>
            </div>
            {attach((file) => {
              const saved = onChange({ file });
              if (saved) setAssociate(false);
              return saved;
            })}
          </div>
        </div>
      )}
    </DocumentEditorFrame>
  );
}
