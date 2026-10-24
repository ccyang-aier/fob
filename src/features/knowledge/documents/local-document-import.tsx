'use client';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './local-document-import.messages';
import { useState } from 'react';
import { useAppAlert } from '@/components/app-alert-provider';
import { saveLocalAsset } from '../assets/local-assets';
import { documentFileAccept, documentFileFormat, type DocumentFile } from './file-format';
import { FilePlus } from '@phosphor-icons/react';
export function LocalDocumentImport({
  onImport,
  knowledgeBaseId,
}: {
  knowledgeBaseId: string;
  onImport: (
    items: {
      name: string;
      text: string;
      file: DocumentFile;
    }[],
  ) => boolean;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const { notify } = useAppAlert();
  const [busy, setBusy] = useState(false);
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const items = await Promise.all(
        Array.from(files).map(async (file) => {
          if (!documentFileFormat(file.name))
            throw new Error(knowledgeT('chooseASupportedFormatSuchAsPdfPptx'));
          if (file.size > 100 * 1024 * 1024)
            throw new Error(knowledgeT('eachPreviewFileMustBeNoLargerThan'));
          const source = await saveLocalAsset(knowledgeBaseId, file);
          return {
            name: file.name,
            text: '',
            file: { source, name: file.name, mime: file.type, size: file.size },
          };
        }),
      );
      if (onImport(items))
        notify(
          'success',
          knowledgeT(
            items.length === 1
              ? 'importedOneDocumentAndSavedItLocally'
              : 'importedValueDocumentsAndSavedThemLocally',
            { v0: items.length },
          ),
        );
      else notify('error', knowledgeT('unableToSaveCheckBrowserStorageSpace'));
    } catch (error) {
      notify(
        'error',
        error instanceof Error ? error.message : knowledgeT('unableToReadChooseTheFileAgain'),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!busy) void importFiles(event.dataTransfer.files);
      }}
      className="rounded-xl border border-dashed border-[var(--control-border)] bg-[var(--surface-subtle)] p-7 text-center"
    >
      <UploadSimpleIcon />
      <p className="mb-4 text-xs leading-6 text-[var(--muted-strong)]">
        {knowledgeT('dropDocumentsHereOrChoosePdfPptxWord')}
        <br />
        {knowledgeT('contentIsStoredOnlyInThisBrowserUp')}
      </p>
      <label className="inline-block cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-xs text-[var(--accent-foreground)] hover:bg-[var(--accent-strong)]">
        {busy ? knowledgeT('importing') : knowledgeT('chooseFiles')}
        <input
          className="sr-only"
          aria-label={knowledgeT('chooseDocumentFiles')}
          type="file"
          accept={documentFileAccept}
          multiple
          disabled={busy}
          onChange={(event) => {
            void importFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </label>
    </div>
  );
}
function UploadSimpleIcon() {
  return <FilePlus size={28} className="mx-auto mb-3 text-[var(--muted-strong)]" />;
}
