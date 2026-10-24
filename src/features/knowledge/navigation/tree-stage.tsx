'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './tree-stage.messages';
import { useMemo, useState } from 'react';
import type { Teamspace } from '@fob/shared/knowledge/contracts';
import type { KnowledgeAccess } from '../data/hooks';
import { useKnowledgePagesQuery } from '../data/pages-queries';
import {
  ExpandedPrimarySidebar,
  type SidebarSectionId,
} from '../dense-sidebar/expanded-primary-sidebar';
import type { SidebarProjectNode } from '../dense-sidebar/sidebar-navigation';
import type { SidebarProjectAction } from '../dense-sidebar/sidebar-project-tree';
import { DialogButton, ModalDialog, NameField } from '../organization/ui';
import { KnowledgeBaseActions } from './knowledge-base-actions';
import { NavigationDialogPortal } from './navigation-dialog-portal';
import { TreeError, TreeForbidden, TreeLoading } from './page-tree-sidebar';
import { buildNavigationSections, type NavigationPageNode } from './tree-model';
import { sidebarDocuments } from './sidebar-documents';
import { useSidebarCollections } from './sidebar-collections';
import { useDocumentNavigationActions } from './document-navigation-actions';
import { canEditTree } from './tree-actions';
import type { TreeNotifier } from './page-operations';

export type TreeStageTeamspaceState = 'loading' | 'error' | 'forbidden' | 'empty' | 'ready';
export type LibraryView =
  'overview' | 'all-documents' | 'starred' | 'drafts' | 'trash' | 'projects' | 'recent';

export function KnowledgeTreeStage({
  knowledgeBaseId,
  userId,
  teamspaces,
  teamspaceState,
  access,
  selectedSectionId,
  selectedPageId,
  onSelectSection,
  onSelectPage,
  onRetryTeamspaces,
  onCreateTeamspace,
  notify,
  view,
  onNavigate,
}: {
  userId: string;
  knowledgeBaseId: string;
  teamspaces: readonly Teamspace[];
  teamspaceState: TreeStageTeamspaceState;
  access: KnowledgeAccess | undefined;
  selectedSectionId: string | null;
  selectedPageId: string | null;
  onSelectSection: (id: string) => void;
  onSelectPage: (id: string) => void;
  onRetryTeamspaces: () => void;
  onCreateTeamspace: () => void;
  notify: TreeNotifier;
  view: LibraryView;
  onNavigate: (view: LibraryView) => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const pagesQuery = useKnowledgePagesQuery(knowledgeBaseId, {
    enabled: teamspaceState === 'ready',
  });
  const pages = useMemo(() => {
    const folderIds = new Set(teamspaces.map((folder) => folder.id));
    return (pagesQuery.data ?? []).filter((page) => folderIds.has(page.teamspaceId));
  }, [pagesQuery.data, teamspaces]);
  const sections = useMemo(
    () => buildNavigationSections(teamspaces, pages, locale),
    [teamspaces, pages, locale],
  );
  const documents = useMemo(() => sidebarDocuments(sections, pages), [sections, pages]);
  const { collections, setCollections, toggleStar } = useSidebarCollections(
    userId,
    knowledgeBaseId,
  );
  const [expandedSections, setExpandedSections] = useState<Record<SidebarSectionId, boolean>>({
    projects: true,
    tags: true,
    recent: false,
  });
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [expandedTags, setExpandedTags] = useState<Record<string, boolean>>({});
  const [location, setLocation] = useState<'project' | 'recent' | 'tag'>('project');
  const [folderAction, setFolderAction] = useState<{
    teamspace: Teamspace;
    action: 'rename' | 'delete';
  } | null>(null);
  const [tagAction, setTagAction] = useState<{ id: string; pageIds: string[] } | null>(null);
  const [tagName, setTagName] = useState('');
  function openPage(id: string, from: typeof location = 'project') {
    const page = pages.find((item) => item.id === id);
    if (page) onSelectSection(page.teamspaceId);
    setLocation(from);
    onSelectPage(id);
  }
  const actions = useDocumentNavigationActions({
    knowledgeBaseId: knowledgeBaseId ?? '',
    userId,
    pages,
    teamspaces,
    canEdit: canEditTree(access),
    onOpenPage: openPage,
    notify,
  });
  const toNode = (node: NavigationPageNode): SidebarProjectNode => ({
    id: node.id,
    kind: 'document',
    label: node.title,
    icon: 'file',
    documentIcon: node.icon,
    starred: collections.starred.includes(node.id),
    expandable: node.children.length > 0,
    defaultExpanded: true,
    children: node.children.map(toNode),
  });
  const projects: SidebarProjectNode[] = sections.map((section) => ({
    id: section.id,
    kind: 'project',
    label: section.title,
    count: documents.filter((page) => page.teamspaceId === section.id).length,
    projectIconId: 'folder',
    starred: collections.starred.includes(section.id),
    expandable: section.pages.length > 0,
    defaultExpanded: true,
    children: section.pages.map(toNode),
  }));
  const tags = collections.tags.map((tag) => ({ id: tag.id, name: tag.name, color: '#ada34e' }));
  const tagDocuments = Object.fromEntries(
    collections.tags.map((tag) => [
      tag.id,
      documents
        .filter((page) => tag.pageIds.includes(page.id))
        .map((page) => ({
          id: page.id,
          title: page.title || knowledgeT('untitledPage'),
          icon: page.icon,
          starred: collections.starred.includes(page.id),
        })),
    ]),
  );
  function addTag(name: string, pageIds: string[] = []) {
    setCollections((current) => ({
      ...current,
      tags: [...current.tags, { id: crypto.randomUUID(), name, pageIds }],
    }));
  }
  function projectAction(id: string, action: SidebarProjectAction) {
    const teamspace = teamspaces.find((item) => item.id === id);
    if (!teamspace) return;
    if (action === 'new-document') void actions.create(id);
    if (action === 'rename' || action === 'delete') setFolderAction({ teamspace, action });
    if (action === 'toggle-star') toggleStar(id);
    if (action === 'add-tag') {
      setTagAction({
        id: crypto.randomUUID(),
        pageIds: documents.filter((page) => page.teamspaceId === id).map((page) => page.id),
      });
      setTagName('');
    }
  }
  return (
    <>
      {teamspaceState === 'loading' || (teamspaceState === 'ready' && pagesQuery.isPending) ? (
        <TreeLoading />
      ) : teamspaceState === 'error' || pagesQuery.isError ? (
        <TreeError
          onRetry={() => {
            onRetryTeamspaces();
            void pagesQuery.refetch();
          }}
        />
      ) : teamspaceState === 'forbidden' ? (
        <TreeForbidden />
      ) : (
        <ExpandedPrimarySidebar
          className="min-h-0 flex-1"
          activeItem={selectedPageId ? '' : view}
          activeResource={
            !selectedPageId && view === 'overview' && selectedSectionId
              ? `project:${selectedSectionId}`
              : null
          }
          activeDocumentId={selectedPageId}
          activeDocumentLocation={location}
          counts={{
            'all-documents': documents.length,
            starred: documents.filter((page) => collections.starred.includes(page.id)).length,
            drafts: documents.filter((page) => collections.drafts.includes(page.id)).length,
            trash: pages.filter((page) => page.deletedAt).length,
            projects: documents.length,
            tags: new Set(
              Object.values(tagDocuments)
                .flat()
                .map((page) => page.id),
            ).size,
          }}
          projects={projects}
          tags={tags}
          tagDocuments={tagDocuments}
          recentNotes={documents.slice(0, 10).map((page) => ({
            id: page.id,
            label: page.title || knowledgeT('untitledPage'),
            icon: page.icon,
            starred: collections.starred.includes(page.id),
          }))}
          expandedSections={expandedSections}
          expandedProjects={expandedProjects}
          expandedTags={expandedTags}
          onNavigateMain={(id) => onNavigate(id as LibraryView)}
          onSelectProject={(id) => {
            onSelectSection(id);
            onNavigate('overview');
          }}
          onSelectDocument={(id) => openPage(id)}
          onToggleProject={(id) =>
            setExpandedProjects((current) => ({ ...current, [id]: !(current[id] ?? true) }))
          }
          onProjectAction={projectAction}
          onTagAction={(id, action) => {
            const tag = collections.tags.find((item) => item.id === id);
            if (!tag) return;
            if (action === 'delete')
              setCollections((current) => ({
                ...current,
                tags: current.tags.filter((item) => item.id !== id),
              }));
            if (action === 'rename') {
              setTagAction(tag);
              setTagName(tag.name);
            }
            if (action === 'new-document')
              void actions.create(selectedSectionId ?? undefined).then((pageId) => {
                if (pageId)
                  setCollections((current) => ({
                    ...current,
                    tags: current.tags.map((item) =>
                      item.id === id ? { ...item, pageIds: [...item.pageIds, pageId] } : item,
                    ),
                  }));
              });
          }}
          onDocumentAction={actions.act}
          onToggleSection={(section) =>
            setExpandedSections((current) => ({ ...current, [section]: !current[section] }))
          }
          onNewProject={onCreateTeamspace}
          onCreateTag={addTag}
          onSelectTagDocument={(id) => openPage(id, 'tag')}
          onToggleTag={(id) =>
            setExpandedTags((current) => ({ ...current, [id]: !(current[id] ?? true) }))
          }
          onSelectRecent={(id) => openPage(id, 'recent')}
        />
      )}
      {folderAction && knowledgeBaseId ? (
        <KnowledgeBaseActions
          key={`${folderAction.teamspace.id}:${folderAction.action}`}
          knowledgeBaseId={knowledgeBaseId}
          target={folderAction}
          onClose={() => setFolderAction(null)}
          onRemoved={() => onSelectSection('')}
          notify={notify}
        />
      ) : null}
      {tagAction ? (
        <NavigationDialogPortal>
          <ModalDialog
            open
            title={knowledgeT('tagName')}
            onClose={() => setTagAction(null)}
            footer={
              <>
                <DialogButton onClick={() => setTagAction(null)}>
                  {knowledgeT('cancel')}
                </DialogButton>
                <DialogButton
                  variant="primary"
                  disabled={!tagName.trim()}
                  onClick={() => {
                    setCollections((current) => ({
                      ...current,
                      tags: [
                        ...current.tags.filter((tag) => tag.id !== tagAction.id),
                        { ...tagAction, name: tagName.trim() },
                      ],
                    }));
                    setTagAction(null);
                  }}
                >
                  {knowledgeT('save')}
                </DialogButton>
              </>
            }
          >
            <NameField
              label={knowledgeT('name')}
              value={tagName}
              onChange={setTagName}
              autoFocus
              maxLength={80}
            />
          </ModalDialog>
        </NavigationDialogPortal>
      ) : null}
      {actions.dialogs}
    </>
  );
}
