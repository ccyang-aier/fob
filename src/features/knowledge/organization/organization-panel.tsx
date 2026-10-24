'use client';

import { createTranslator, useTranslation, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './organization-panel.messages';
import { useState } from 'react';
import { FolderOpen } from '@phosphor-icons/react';
import { useIdentity } from '@/features/identity/identity-provider';
import { cn } from '@/lib/utils';
import { useKnowledgeAccessQuery } from '../data/hooks';
import { useKnowledgeBasesQuery } from '../data/catalog-queries';
import { GroupsSection } from './groups-section';
import { OrganizationQueryProvider } from './hooks';
import { MembersSection } from './members-section';
import { TeamspacesSection } from './teamspaces-section';
import { ListStateShell, RoleBadge, flattenPages, queryListState } from './ui';
import { useAppAlert } from '@/components/app-alert-provider';
import { useProjectResources } from '@/features/project/project-resources';

type SectionId = 'members' | 'groups' | 'teamspaces';
function sections(locale?: Locale): readonly { id: SectionId; label: string }[] {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    { id: 'members', label: knowledgeT('members') },
    { id: 'groups', label: knowledgeT('groups') },
    { id: 'teamspaces', label: knowledgeT('folder') },
  ];
}

export function OrganizationPanel() {
  const { session } = useIdentity();
  return (
    <OrganizationQueryProvider key={session.status === 'authenticated' ? session.user.id : 'guest'}>
      <OrganizationPanelBody />
    </OrganizationQueryProvider>
  );
}

function OrganizationPanelBody() {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const { session } = useIdentity();
  const { selectedProject } = useProjectResources();
  const basesQuery = useKnowledgeBasesQuery(session.status === 'authenticated');
  const bases = flattenPages(basesQuery.data);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>('members');
  const { notify } = useAppAlert();
  const activeBase = bases.find((base) => base.id === selectedId) ?? bases[0] ?? null;
  const access = useKnowledgeAccessQuery(activeBase?.id ?? '', { enabled: activeBase !== null });
  const role = access.data?.role;
  return (
    <section
      aria-label={knowledgeT('knowledgeBaseMembersAndDirectory')}
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-panel"
    >
      <header className="flex h-[42px] shrink-0 items-center justify-between gap-4 border-b border-[var(--line)] px-[18px]">
        <nav
          aria-label={knowledgeT('breadcrumbs')}
          className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--muted)]"
        >
          <span>{knowledgeT('knowledgeBase')}</span>
          <span aria-hidden>/</span>
          <strong className="truncate font-medium text-[var(--muted-strong)]">
            {knowledgeT('membersAndDirectory')}
          </strong>
        </nav>
        {role ? (
          <span className="flex h-7 shrink-0 items-center gap-1.5 text-[10px] text-[var(--muted-strong)]">
            {knowledgeT('myRole')}
            <RoleBadge role={role} />
          </span>
        ) : null}
      </header>
      {session.status === 'authenticated' && activeBase ? (
        <>
          <div className="flex h-[46px] shrink-0 items-center justify-between gap-4 border-b border-[var(--line)] px-[18px]">
            <select
              aria-label={knowledgeT('selectKnowledgeBase')}
              value={activeBase.id}
              onChange={(event) => setSelectedId(event.target.value)}
              className="h-8 min-w-[220px] max-w-[340px] cursor-pointer rounded border border-[var(--control-border)] bg-panel px-2.5 text-[11.5px] outline-none focus:border-[var(--accent)]"
            >
              {bases.map((base) => (
                <option key={base.id} value={base.id}>
                  {base.name}
                </option>
              ))}
            </select>
            <nav
              aria-label={knowledgeT('managementSections')}
              className="flex h-full items-center gap-1"
            >
              {sections(locale).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={section === item.id ? 'page' : undefined}
                  onClick={() => setSection(item.id)}
                  className={cn(
                    'fob-action relative h-full px-3 text-[11.5px] font-medium',
                    section === item.id ? 'text-[var(--ink)]' : 'text-[var(--muted-strong)]',
                  )}
                >
                  {item.label}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-x-2 bottom-0 h-[2px] rounded-full',
                      section === item.id ? 'bg-[var(--accent)]' : 'bg-transparent',
                    )}
                  />
                </button>
              ))}
            </nav>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[900px] px-6 py-5">
              {role ? (
                section === 'members' ? (
                  <MembersSection
                    knowledgeBaseId={activeBase.id}
                    actorRole={role}
                    notify={notify}
                  />
                ) : section === 'groups' ? (
                  <GroupsSection knowledgeBaseId={activeBase.id} actorRole={role} notify={notify} />
                ) : (
                  <TeamspacesSection
                    knowledgeBaseId={activeBase.id}
                    actorRole={role}
                    notify={notify}
                  />
                )
              ) : (
                <ListStateShell
                  state={access.isError ? 'error' : 'loading'}
                  error={access.error}
                  onRetry={() => void access.refetch()}
                  emptyTitle={knowledgeT('unableToVerifyKnowledgeBasePermissions')}
                >
                  {null}
                </ListStateShell>
              )}
            </div>
          </div>
        </>
      ) : (
        <ListStateShell
          state={selectedProject?.source !== 'server' ? 'empty' : session.status === 'anonymous' ? 'unauthenticated' : queryListState(basesQuery)}
          error={basesQuery.error}
          onRetry={() => void basesQuery.refetch()}
          emptyIcon={<FolderOpen className="size-6" aria-hidden />}
          emptyTitle={knowledgeT('noKnowledgeBasesToManage')}
        >
          {null}
        </ListStateShell>
      )}
    </section>
  );
}
