'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './expanded-primary-sidebar.messages';
import * as React from 'react';
import { Clock, Folder, Tag } from '@/components/icons';

import type { DocumentAction } from '@/features/knowledge/dense-sidebar/document-action-menu-content';
import {
  SidebarCollapsibleContent,
  SidebarCreateIcon,
  SidebarSectionHeader,
} from '@/features/knowledge/dense-sidebar/sidebar-navigation-primitives';
import {
  SidebarProjectTreeNode,
  type SidebarProjectAction,
} from '@/features/knowledge/dense-sidebar/sidebar-project-tree';
import {
  SidebarTagTreeNode,
  type SidebarTagAction,
} from '@/features/knowledge/dense-sidebar/sidebar-tag-tree';
import { SidebarRecentNotes } from '@/features/knowledge/dense-sidebar/sidebar-recent-notes';
import { IconButton } from './icon-button';
import { KnowledgeMainNavigation } from './knowledge-main-navigation';
import { useKnowledgeNavigationCompact } from '../navigation/system-navigation';
import type {
  SidebarProjectNode,
  SidebarRecentNote,
} from '@/features/knowledge/dense-sidebar/sidebar-navigation';
import type { TagSummary } from '@/features/knowledge/dense-sidebar/sidebar-navigation';
import type { SidebarDocumentSummary } from '@/features/knowledge/dense-sidebar/sidebar-navigation';
import { useI18n } from '@/features/knowledge/dense-sidebar/use-i18n';
import { cn } from '@/lib/utils';

export type SidebarSectionId = 'projects' | 'tags' | 'recent';

export function ExpandedPrimarySidebar({
  header,
  collapsed = false,
  activeItem,
  className,
  activeResource,
  activeDocumentId,
  activeDocumentLocation,
  counts,
  projects,
  tags,
  tagDocuments,
  recentNotes,
  expandedProjects,
  expandedTags,
  expandedSections,
  onNavigateMain,
  onSelectProject,
  onSelectDocument,
  onToggleProject,
  onProjectAction,
  onTagAction,
  onDocumentAction,
  onToggleSection,
  onNewProject,
  onCreateTag,
  onSelectTagDocument,
  onToggleTag,
  onSelectRecent,
}: {
  header?: React.ReactNode;
  collapsed?: boolean;
  activeItem: string;
  className?: string;
  activeResource: string | null;
  activeDocumentId: string | null;
  activeDocumentLocation: 'project' | 'recent' | 'tag' | null;
  counts: Record<string, number>;
  projects: SidebarProjectNode[];
  tags: TagSummary[];
  tagDocuments: Record<string, SidebarDocumentSummary[]>;
  recentNotes: SidebarRecentNote[];
  expandedProjects: Record<string, boolean>;
  expandedTags: Record<string, boolean>;
  expandedSections: Record<SidebarSectionId, boolean>;
  onNavigateMain: (id: string) => void;
  onSelectProject: (id: string) => void;
  onSelectDocument: (id: string) => void;
  onToggleProject: (id: string) => void;
  onProjectAction: (id: string, action: SidebarProjectAction) => void;
  onTagAction: (id: string, action: SidebarTagAction) => void;
  onDocumentAction: (id: string, action: DocumentAction) => void;
  onToggleSection: (section: SidebarSectionId) => void;
  onNewProject: () => void;
  onCreateTag: (name: string) => void;
  onSelectTagDocument: (documentId: string) => void;
  onToggleTag: (tagId: string) => void;
  onSelectRecent: (id: string) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const { t } = useI18n();
  const compact = useKnowledgeNavigationCompact();
  const [tagPopoverOpen, setTagPopoverOpen] = React.useState(false);
  const [tagName, setTagName] = React.useState('');

  const submitTag = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const value = tagName.trim();
      if (!value) return;
      onCreateTag(value);
      setTagName('');
      setTagPopoverOpen(false);
    },
    [onCreateTag, tagName],
  );

  if (compact) return <KnowledgeMainNavigation compact activeItem={activeItem} counts={counts} onNavigate={onNavigateMain} />;

  return (
    <nav
      aria-label={t('nav.primary')}
      aria-hidden={collapsed}
      inert={collapsed}
      data-collapsed={collapsed}
      className={cn(
        'group/sidebar relative z-20 flex h-full min-h-0 flex-col overflow-hidden',
        className,
      )}
    >
      {header}
      <div className="min-h-0 flex flex-1 flex-col px-[11px] pb-4 pt-2">
        <div className="scrollbar-hidden min-h-0 shrink overflow-y-auto pr-px">
          <KnowledgeMainNavigation activeItem={activeItem} counts={counts} onNavigate={onNavigateMain} />

          <section className="mt-[15px]">
            <SidebarSectionHeader
              icon={Folder}
              label={t('sidebar.projects')}
              expanded={expandedSections.projects}
              onToggle={() => onToggleSection('projects')}
              count={counts.projects}
              selected={activeItem === 'projects'}
              actions={
                <>
                  <IconButton
                    label={t('sidebar.newProject')}
                    className="size-[20px] rounded-[4px] text-muted-foreground shadow-none hover:bg-[var(--knowledge-sidebar-state-bg)] hover:text-foreground"
                    onClick={onNewProject}
                  >
                    <SidebarCreateIcon />
                  </IconButton>
                </>
              }
            />
            <SidebarCollapsibleContent expanded={expandedSections.projects}>
              <div role="tree" aria-label={t('sidebar.projects')} className="space-y-0.5 pt-0.5">
                {projects.map((node) => (
                  <SidebarProjectTreeNode
                    key={node.id}
                    node={node}
                    depth={0}
                    expanded={expandedProjects}
                    selectedProjectId={activeResource}
                    activeDocumentId={activeDocumentId}
                    activeDocumentLocation={
                      activeDocumentLocation === 'tag' ? null : activeDocumentLocation
                    }
                    onToggle={onToggleProject}
                    onSelectProject={onSelectProject}
                    onSelectDocument={onSelectDocument}
                    onProjectAction={onProjectAction}
                    onDocumentAction={onDocumentAction}
                  />
                ))}
              </div>
            </SidebarCollapsibleContent>
          </section>

          <section className="mt-[13px]">
            <SidebarSectionHeader
              icon={Tag}
              label={t('sidebar.tags')}
              count={counts.tags}
              expanded={expandedSections.tags}
              onToggle={() => onToggleSection('tags')}
              actions={
                <IconButton
                  label={t('sidebar.newTag')}
                  tooltipSide="top"
                  className="size-[20px] rounded-[4px] text-muted-foreground shadow-none hover:bg-[var(--knowledge-sidebar-state-bg)] hover:text-foreground"
                  onClick={() => setTagPopoverOpen((open) => !open)}
                >
                  <SidebarCreateIcon />
                </IconButton>
              }
            />
            {tagPopoverOpen && (
              <form
                onSubmit={submitTag}
                className="my-1 flex gap-1 rounded-md border border-[var(--line)] bg-panel p-1"
              >
                <input
                  autoFocus
                  aria-label={knowledgeT('tagName')}
                  value={tagName}
                  onChange={(event) => setTagName(event.target.value)}
                  className="min-w-0 flex-1 px-1 text-xs outline-none"
                />
                <button
                  type="submit"
                  disabled={!tagName.trim()}
                  className="px-2 text-xs text-[var(--ink)] disabled:opacity-40"
                >
                  {knowledgeT('create')}
                </button>
              </form>
            )}
            <SidebarCollapsibleContent expanded={expandedSections.tags}>
              <div role="tree" aria-label={t('sidebar.tags')} className="space-y-0.5 pt-0.5">
                {tags.map((tag) => (
                  <SidebarTagTreeNode
                    key={tag.id}
                    tag={tag}
                    documents={tagDocuments[tag.id] ?? []}
                    expanded={expandedTags[tag.id] ?? true}
                    activeDocumentId={activeDocumentId}
                    activeDocumentLocation={activeDocumentLocation}
                    onToggle={onToggleTag}
                    onSelectDocument={onSelectTagDocument}
                    onTagAction={onTagAction}
                    onDocumentAction={onDocumentAction}
                  />
                ))}
              </div>
            </SidebarCollapsibleContent>
          </section>
        </div>

        <section
          className={cn(
            'mt-[13px] min-h-0',
            expandedSections.recent ? 'flex flex-1 flex-col' : 'shrink-0',
          )}
        >
          <SidebarSectionHeader
            icon={Clock}
            label={t('sidebar.recentNotes')}
            expanded={expandedSections.recent}
            onToggle={() => onToggleSection('recent')}
            count={recentNotes.length}
            selected={activeItem === 'recent'}
          />
          <SidebarCollapsibleContent
            expanded={expandedSections.recent}
            className={expandedSections.recent ? 'min-h-0 flex-1' : undefined}
            contentClassName={expandedSections.recent ? 'h-full' : undefined}
          >
            <div className="h-full min-h-0 pt-0.5">
              <SidebarRecentNotes
                notes={recentNotes}
                activeRecentId={activeDocumentLocation === 'recent' ? activeDocumentId : null}
                onSelectRecent={onSelectRecent}
                onDocumentAction={onDocumentAction}
              />
            </div>
          </SidebarCollapsibleContent>
        </section>
      </div>
    </nav>
  );
}
