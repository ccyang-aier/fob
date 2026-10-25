'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './local-library-navigation.messages';
import { useEffect, useRef, useState } from 'react';
import {
  CaretRight,
  Clock,
  DotsThree,
  Folder,
  PencilSimple,
  Plus,
  Tag,
  Trash,
} from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { IconButton } from '../dense-sidebar/icon-button';
import {
  SidebarRow,
  SidebarSectionHeader,
} from '../dense-sidebar/sidebar-navigation-primitives';
import { KnowledgeMainNavigation } from '../dense-sidebar/knowledge-main-navigation';
import { useKnowledgeNavigationCompact } from '../navigation/system-navigation';
import styles from '../dense-sidebar/sidebar-interactions.module.css';
import { PageIcon } from '../navigation/page-icon';
import type { LocalDocument, LocalLibrary, LocalTag } from './local-library';

type MainView = 'all-documents' | 'starred' | 'drafts' | 'trash';
const tagColors = ['#5582c4', '#cb805c', '#5d9d83', '#a87ac0', '#d6a24c', '#688aab'] as const;
const emptyHintTextClassName = 'py-1 text-[11px] leading-4 text-[var(--muted)]';

export function LocalLibraryNavigation({
  view,
  counts,
  selectedId,
  activeTagId,
  folders,
  documents,
  tags,
  hasKnowledgeBase,
  onSelectMain,
  onSelectDocument,
  onCreateFolder,
  onCreateDocument,
  onCreateDocumentInFolder,
  onRenameFolder,
  onRemoveFolder,
  onCreateDocumentInTag,
  onCreateTag,
  onRenameTag,
  onRemoveTag,
}: {
  view: MainView;
  hasKnowledgeBase: boolean;
  counts: Record<MainView, number>;
  selectedId: string | null;
  activeTagId: string | null;
  folders: LocalLibrary['folders'];
  documents: LocalDocument[];
  tags: LocalTag[];
  onSelectMain: (view: MainView) => void;
  onSelectDocument: (id: string) => void;
  onCreateFolder: () => void;
  onCreateDocument: () => void;
  onCreateDocumentInFolder: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onRemoveFolder: (id: string) => void;
  onCreateDocumentInTag: (id: string) => void;
  onCreateTag: (name: string) => void;
  onRenameTag: (id: string, name: string) => void;
  onRemoveTag: (id: string) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const compact = useKnowledgeNavigationCompact();
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([]);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderRenameDraft, setFolderRenameDraft] = useState('');
  const [tagsOpen, setTagsOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const [creatingTag, setCreatingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [expandedTagIds, setExpandedTagIds] = useState<string[]>([]);
  const [renamingTagId, setRenamingTagId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const folderRenameInputRef = useRef<HTMLInputElement>(null);
  const recent = [...documents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);

  useEffect(() => {
    if (!renamingTagId) return;
    const frame = requestAnimationFrame(() => renameInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [renamingTagId]);

  useEffect(() => {
    if (!renamingFolderId) return;
    const frame = requestAnimationFrame(() => folderRenameInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [renamingFolderId]);

  function submitTag(event: React.FormEvent) {
    event.preventDefault();
    const name = tagDraft.trim();
    if (!name || !hasKnowledgeBase) return;
    onCreateTag(name);
    setTagDraft('');
    setCreatingTag(false);
  }

  function renameTag(id: string) {
    const name = renameDraft.trim();
    if (name) onRenameTag(id, name);
    setRenamingTagId(null);
  }

  function renameFolder(id: string) {
    const name = folderRenameDraft.trim();
    if (name) onRenameFolder(id, name);
    setRenamingFolderId(null);
  }

  function toggleTag(id: string) {
    setExpandedTagIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  const activeItem = !selectedId && !activeTagId ? view : null;
  if (compact) return <KnowledgeMainNavigation compact activeItem={activeItem} counts={counts} onNavigate={id => onSelectMain(id as MainView)} />;

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
      <KnowledgeMainNavigation activeItem={activeItem} counts={counts} onNavigate={id => onSelectMain(id as MainView)} />

      <section className="mt-5" aria-label={knowledgeT('folder')}>
        <SidebarSectionHeader
          icon={Folder}
          label={knowledgeT('folder')}
          count={folders.length}
          expanded={foldersOpen}
          onToggle={() => setFoldersOpen((open) => !open)}
          actions={
            hasKnowledgeBase ? (
              <IconButton
                label={knowledgeT('newFolder')}
                disabled={!hasKnowledgeBase}
                tooltip={
                  hasKnowledgeBase
                    ? knowledgeT('newFolder')
                    : knowledgeT('createAKnowledgeBaseFirst')
                }
                onClick={onCreateFolder}
                className="rounded p-1 enabled:hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={14} />
              </IconButton>
            ) : undefined
          }
        />
        {foldersOpen ? (
          <div className="mt-0.5 space-y-0.5">
            {folders.map((folder) => {
              const folderDocuments = documents.filter((doc) => doc.folderId === folder.id);
              const expanded = expandedFolderIds.includes(folder.id);
              return (
                <div key={folder.id}>
                  <div
                    className={cn(
                      styles.row,
                      styles.transientRow,
                      'group flex h-[30px] items-center rounded-[6px] text-[13px] text-[var(--sidebar-text)]',
                    )}
                  >
                    {renamingFolderId === folder.id ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          renameFolder(folder.id);
                        }}
                        className="min-w-0 flex-1 pl-[34px] pr-1"
                      >
                        <input
                          ref={folderRenameInputRef}
                          aria-label={knowledgeT('renameFolderValue', { v0: folder.name })}
                          value={folderRenameDraft}
                          onChange={(event) => setFolderRenameDraft(event.target.value)}
                          onBlur={() => renameFolder(folder.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setRenamingFolderId(null);
                              event.stopPropagation();
                            }
                          }}
                          className="h-6 w-full rounded border border-[var(--focus-ring)] bg-[var(--panel)] px-1 text-[12px] outline-none"
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        aria-label={knowledgeT('valueFolderValue', {
                          v0: expanded ? knowledgeT('collapse') : knowledgeT('expand'),
                          v1: folder.name,
                        })}
                        aria-expanded={expanded}
                        onClick={() =>
                          setExpandedFolderIds((current) =>
                            expanded
                              ? current.filter((id) => id !== folder.id)
                              : [...current, folder.id],
                          )
                        }
                        className="flex h-full min-w-0 flex-1 items-center pl-[14px] pr-1 text-left focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                      >
                        <CaretRight
                          aria-hidden
                          size={12}
                          className={cn(
                            'mr-[9px] shrink-0 text-[var(--muted)] transition-transform',
                            expanded && 'rotate-90',
                          )}
                        />
                        <Folder
                          aria-hidden
                          size={14}
                          className="mr-2 shrink-0 text-[#7c8387]"
                        />
                        <span className="truncate">{folder.name}</span>
                        <span
                          className={cn(
                            styles.count,
                            'pl-2 group-hover:invisible group-focus-within:invisible',
                          )}
                          style={{ marginLeft: 'auto' }}
                        >
                          {folderDocuments.length}
                        </span>
                      </button>
                    )}
                    <div className={cn(styles.actions, 'flex items-center gap-0.5')}>
                      <IconButton
                        label={knowledgeT('createDocumentInValue', { v0: folder.name })}
                        tooltip={knowledgeT('newDocument')}
                        className={styles.actionButton}
                        onClick={() => onCreateDocumentInFolder(folder.id)}
                      >
                        <Plus size={14} />
                      </IconButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            label={knowledgeT('moreActionsForValue', { v0: folder.name })}
                            tooltip={knowledgeT('more')}
                            className={styles.actionButton}
                          >
                            <DotsThree size={14} />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          onCloseAutoFocus={(event) => {
                            if (renamingFolderId === folder.id) event.preventDefault();
                          }}
                        >
                          <DropdownMenuItem
                            onSelect={() => {
                              setFolderRenameDraft(folder.name);
                              setRenamingFolderId(folder.id);
                            }}
                          >
                            <PencilSimple />
                            {knowledgeT('rename')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => onRemoveFolder(folder.id)}
                          >
                            <Trash />
                            {knowledgeT('deleteFolder')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {expanded ? (
                    <div className="space-y-0.5">
                      {folderDocuments.map((doc) => (
                        <SidebarRow
                          key={doc.id}
                          depth={2}
                          leading={
                            <PageIcon value={doc.icon} size={15} className="mr-2 shrink-0" />
                          }
                          label={doc.title || knowledgeT('untitledDocument')}
                          selected={selectedId === doc.id}
                          onClick={() => onSelectDocument(doc.id)}
                        />
                      ))}
                      {!folderDocuments.length ? (
                        <p className={cn(emptyHintTextClassName, 'pl-9')}>
                          {knowledgeT('noDocuments')}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {documents
              .filter((doc) => !doc.folderId)
              .map((doc) => (
                <SidebarRow
                  key={doc.id}
                  depth={1}
                  leading={<PageIcon value={doc.icon} size={15} className="mr-2 shrink-0" />}
                  label={doc.title || knowledgeT('untitledDocument')}
                  selected={selectedId === doc.id}
                  onClick={() => onSelectDocument(doc.id)}
                />
              ))}
            {!folders.length && !documents.length ? (
              hasKnowledgeBase ? (
                <p className={cn(emptyHintTextClassName, 'px-1')}>
                  <button
                    type="button"
                    onClick={onCreateDocument}
                    className="rounded text-left [font:inherit] hover:text-[var(--ink)]"
                  >
                    {knowledgeT('noDocumentsCreateYourFirstDocument')}
                  </button>
                </p>
              ) : (
                <>
                  <p className={cn(emptyHintTextClassName, 'px-1')}>{knowledgeT('noFolders')}</p>
                  <button
                    type="button"
                    disabled
                    title={knowledgeT('createAKnowledgeBaseFirst')}
                    className="mt-1 flex h-[30px] items-center gap-2 px-1 text-[12px] text-[var(--muted)] opacity-45 cursor-not-allowed"
                  >
                    <Plus size={14} aria-hidden />
                    {knowledgeT('newFolder')}
                  </button>
                </>
              )
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="mt-4" aria-label={knowledgeT('tags')}>
        <SidebarSectionHeader
          icon={Tag}
          label={knowledgeT('tags')}
          count={tags.length}
          expanded={tagsOpen}
          onToggle={() => setTagsOpen((open) => !open)}
          actions={
            hasKnowledgeBase ? (
              <IconButton
                label={knowledgeT('newTag')}
                disabled={!hasKnowledgeBase}
                tooltip={
                  hasKnowledgeBase ? knowledgeT('newTag') : knowledgeT('createAKnowledgeBaseFirst')
                }
                onClick={() => {
                  setCreatingTag(true);
                  setTagsOpen(true);
                }}
                className="rounded p-1 enabled:hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={14} />
              </IconButton>
            ) : undefined
          }
        />
        {tagsOpen ? (
          <div className="mt-1 space-y-0.5">
            {creatingTag && hasKnowledgeBase ? (
              <form onSubmit={submitTag} className="flex items-center gap-1 px-1 py-1">
                <input
                  autoFocus
                  aria-label={knowledgeT('tagName')}
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setCreatingTag(false);
                      setTagDraft('');
                    }
                  }}
                  className="min-w-0 flex-1 rounded border border-[var(--line)] bg-transparent px-1.5 py-1 text-xs outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="submit"
                  disabled={!tagDraft.trim()}
                  className="text-[11px] text-[var(--accent-ink)] disabled:opacity-40"
                >
                  {knowledgeT('create')}
                </button>
              </form>
            ) : null}
            {tags.map((tag, index) => {
              const taggedDocuments = documents.filter((doc) => tag.pageIds.includes(doc.id));
              const expanded = expandedTagIds.includes(tag.id);
              return (
                <div key={tag.id}>
                  <div
                    className={cn(
                      styles.row,
                      styles.transientRow,
                      'group flex h-[30px] items-center rounded-[6px] text-[12px] text-[var(--sidebar-text)]',
                    )}
                  >
                    {renamingTagId === tag.id ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          renameTag(tag.id);
                        }}
                        className="min-w-0 flex-1 pl-9 pr-1"
                      >
                        <input
                          ref={renameInputRef}
                          aria-label={knowledgeT('renameTagValue', { v0: tag.name })}
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onBlur={() => renameTag(tag.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setRenamingTagId(null);
                              event.stopPropagation();
                            }
                          }}
                          className="h-6 w-full rounded border border-[var(--focus-ring)] bg-[var(--panel)] px-1 text-[12px] outline-none"
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        aria-label={knowledgeT('valueTagValue', {
                          v0: expanded ? knowledgeT('collapse') : knowledgeT('expand'),
                          v1: tag.name,
                        })}
                        aria-expanded={expanded}
                        onClick={() => toggleTag(tag.id)}
                        className="flex h-full min-w-0 flex-1 items-center pl-[16px] pr-1 text-left focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                      >
                        <CaretRight
                          aria-hidden
                          size={12}
                          className={cn(
                            'mr-[9px] shrink-0 text-[var(--muted)] transition-transform',
                            expanded && 'rotate-90',
                          )}
                        />
                        <span
                          aria-hidden
                          className="mr-2 size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: tagColors[index % tagColors.length] }}
                        />
                        <span className="truncate">{tag.name}</span>
                        <span
                          className={cn(
                            styles.count,
                            'pl-2 group-hover:invisible group-focus-within:invisible',
                          )}
                          style={{ marginLeft: 'auto' }}
                        >
                          {taggedDocuments.length}
                        </span>
                      </button>
                    )}
                    <div className={cn(styles.actions, 'flex items-center gap-0.5')}>
                      <IconButton
                        label={knowledgeT('createDocumentInValue', { v0: tag.name })}
                        tooltip={knowledgeT('newDocument')}
                        className={styles.actionButton}
                        onClick={() => onCreateDocumentInTag(tag.id)}
                      >
                        <Plus size={14} />
                      </IconButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            label={knowledgeT('moreActionsForValue', { v0: tag.name })}
                            tooltip={knowledgeT('more')}
                            className={styles.actionButton}
                          >
                            <DotsThree size={14} />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          onCloseAutoFocus={(event) => {
                            if (renamingTagId === tag.id) event.preventDefault();
                          }}
                        >
                          <DropdownMenuItem
                            onSelect={() => {
                              setRenameDraft(tag.name);
                              setRenamingTagId(tag.id);
                            }}
                          >
                            <PencilSimple />
                            {knowledgeT('rename')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => onRemoveTag(tag.id)}
                          >
                            <Trash />
                            {knowledgeT('deleteTag')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {expanded ? (
                    <div className="space-y-0.5">
                      {taggedDocuments.map((doc) => (
                        <SidebarRow
                          key={doc.id}
                          depth={1}
                          leading={
                            <PageIcon value={doc.icon} size={15} className="mr-2 shrink-0" />
                          }
                          label={doc.title || knowledgeT('untitledDocument')}
                          selected={selectedId === doc.id}
                          onClick={() => onSelectDocument(doc.id)}
                        />
                      ))}
                      {!taggedDocuments.length ? (
                        <p className={cn(emptyHintTextClassName, 'pl-9')}>
                          {knowledgeT('noDocuments')}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!tags.length && !creatingTag ? (
              <p className={cn(emptyHintTextClassName, 'px-1')}>{knowledgeT('noTags')}</p>
            ) : null}
            {!hasKnowledgeBase ? (
              <button
                type="button"
                disabled
                title={knowledgeT('createAKnowledgeBaseFirst')}
                className="mt-1 flex h-[30px] items-center gap-2 px-1 text-[12px] text-[var(--muted)] opacity-45 cursor-not-allowed"
              >
                <Plus size={14} aria-hidden />
                {knowledgeT('newTag')}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="mt-4" aria-label={knowledgeT('recent')}>
        <SidebarSectionHeader
          icon={Clock}
          label={knowledgeT('recent')}
          count={recent.length}
          expanded={recentOpen}
          onToggle={() => setRecentOpen((open) => !open)}
        />
        {recentOpen ? (
          <div className="mt-1 space-y-0.5">
            {recent.map((doc) => (
              <SidebarRow
                key={doc.id}
                depth={1}
                leading={<PageIcon value={doc.icon} size={15} className="mr-2 shrink-0" />}
                label={doc.title || knowledgeT('untitledDocument')}
                selected={selectedId === doc.id}
                onClick={() => onSelectDocument(doc.id)}
              />
            ))}
            {!recent.length ? (
              <p className={cn(emptyHintTextClassName, 'pl-4 pr-1')}>{knowledgeT('noDocuments')}</p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
