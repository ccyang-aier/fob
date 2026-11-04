'use client';

import { createTranslator, useTranslation, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './organization-panel.messages';
import { useState } from 'react';
import { FolderOpen } from '@/components/icons';
import { useIdentity } from '@/features/identity/identity-context';
import { cn } from '@/lib/utils';
import { useKnowledgeAccessQuery } from '../data/hooks';
import { useKnowledgeBasesQuery } from '../data/catalog-queries';
import { OrganizationQueryProvider } from './hooks';
import { MembersSection } from './members-section';
import { TeamspacesSection } from './teamspaces-section';
import { ListStateShell, flattenPages, queryListState } from './ui';
import { useAppAlert } from '@/components/app-alert-provider';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';
import styles from './organization-panel.module.css';

type SectionId = 'members' | 'teamspaces';
function sections(locale?: Locale): readonly { id: SectionId; label: string }[] {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    { id: 'members', label: knowledgeT('members') },
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
            <nav
              aria-label={knowledgeT('managementSections')}
              className={styles.tabs}
            >
              {sections(locale).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={section === item.id}
                  data-surface="plain"
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
                    key={`${activeBase.id}:${role}`}
                    knowledgeBaseId={activeBase.id}
                    actorRole={role}
                    notify={notify}
                    onMembershipChange={() => { void access.refetch(); }}
                  />
                ) : (
                  <TeamspacesSection
                    key={`${activeBase.id}:${role}`}
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
