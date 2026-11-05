'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './organization-panel.messages';
import { FolderOpen } from '@/components/icons';
import { useIdentity } from '@/features/identity/identity-context';
import { useKnowledgeAccessQuery } from '../data/hooks';
import { useKnowledgeBasesQuery } from '../data/catalog-queries';
import { OrganizationQueryProvider } from './hooks';
import { MembersSection } from './members-section';
import { ListStateShell, flattenPages, queryListState } from './ui';
import { useAppAlert } from '@/components/app-alert-provider';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';
import styles from './organization-panel.module.css';

export function OrganizationPanel({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const { session } = useIdentity();
  return (
    <OrganizationQueryProvider key={session.status === 'authenticated' ? session.user.id : 'guest'}>
      <OrganizationPanelBody knowledgeBaseId={knowledgeBaseId} />
    </OrganizationQueryProvider>
  );
}

function OrganizationPanelBody({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const { session } = useIdentity();
  const { selectedKnowledgeBase } = useKnowledgeBaseResources();
  const basesQuery = useKnowledgeBasesQuery(session.status === 'authenticated');
  const bases = flattenPages(basesQuery.data);
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
            <div className={styles.section}>
              {role ? (
                  <MembersSection
                    key={`${activeBase.id}:${role}`}
                    knowledgeBaseId={activeBase.id}
                    actorRole={role}
                    notify={notify}
                    onMembershipChange={() => { void access.refetch(); }}
                  />
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
