'use client';

import { createTranslator, useTranslation, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './organization-panel.messages';
import { useState } from 'react';
import { FolderOpen } from '@/components/icons';
import { useIdentity } from '@/features/identity/identity-context';
import { cn } from '@/lib/utils';
import { useKnowledgeAccessQuery } from '../data/hooks';
import { useKnowledgeBasesQuery } from '../data/catalog-queries';
import { GroupsSection } from './groups-section';
import { OrganizationQueryProvider } from './hooks';
import { MembersSection } from './members-section';
import { TeamspacesSection } from './teamspaces-section';
import { ListStateShell, flattenPages, queryListState } from './ui';
import { KnowledgeMembersButton } from './knowledge-members-menu';
import { memberRoleLabels } from './view-model';
import { useAppAlert } from '@/components/app-alert-provider';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';
import styles from './organization-panel.module.css';

type SectionId = 'members' | 'groups' | 'teamspaces';
function sections(locale?: Locale): readonly { id: SectionId; label: string }[] {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    { id: 'members', label: knowledgeT('members') },
    { id: 'groups', label: knowledgeT('groups') },
    { id: 'teamspaces', label: knowledgeT('folderPermissions') },
  ];
}

export function OrganizationPanel({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const { session } = useIdentity();
  return (
    <OrganizationQueryProvider key={session.status === 'authenticated' ? session.user.id : 'guest'}>
      <OrganizationPanelBody knowledgeBaseId={knowledgeBaseId} />
    </OrganizationQueryProvider>
  );
}

function OrganizationPanelBody({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const { session } = useIdentity();
  const { selectedKnowledgeBase } = useKnowledgeBaseResources();
  const basesQuery = useKnowledgeBasesQuery(session.status === 'authenticated');
  const bases = flattenPages(basesQuery.data);
  const [section, setSection] = useState<SectionId>('members');
  const { notify } = useAppAlert();
  const activeBase = bases.find(base => base.id === knowledgeBaseId) ?? null;
  const access = useKnowledgeAccessQuery(activeBase?.id ?? '', { enabled: activeBase !== null });
  const role = access.data?.role;
  return (
    <section
      aria-label={knowledgeT('knowledgeBaseMembersAndDirectory')}
      className={styles.page}
    >
      {session.status === 'authenticated' && activeBase ? (
        <div className={styles.content}>
          <header className={styles.header}>
            <div>
              <h1 className={styles.title}>{knowledgeT('membersAndPermissions')}</h1>
              <p className={styles.scope}>
                <strong>{activeBase.name}</strong>
                {role ? <><span className={styles.scopeDivider} aria-hidden>·</span><span>{knowledgeT('myRole')}<span aria-hidden>： </span>{memberRoleLabels(locale)[role]}</span></> : null}
              </p>
            </div>
            {role === 'owner' ? <KnowledgeMembersButton className={styles.invite} label={knowledgeT('inviteMembers')} onManage={() => setSection('members')} /> : null}
          </header>
            <nav
              aria-label={knowledgeT('managementSections')}
              className={styles.tabs}
            >
              {sections(locale).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={section === item.id ? 'page' : undefined}
                  data-variant="text"
                  onClick={() => setSection(item.id)}
                  className={cn('fob-action', styles.tab)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className={styles.section}>
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
      ) : (
        <ListStateShell
          state={selectedKnowledgeBase?.source !== 'server' ? 'empty' : session.status === 'anonymous' ? 'unauthenticated' : queryListState(basesQuery)}
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
