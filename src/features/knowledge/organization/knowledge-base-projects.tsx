'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Folders } from '@phosphor-icons/react';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useProjectResources } from '@/features/project/project-resources';
import { useTranslation } from '@/lib/i18n';
import { useKnowledgeAccessQuery } from '../data/hooks';
import { knowledgeCatalogClient } from '../data/knowledge-catalog-client';
import type { KnowledgeBaseSummary } from '../knowledge-base-header';
import { useLocalLibrary } from '../local/use-local-library';
import { NavigationDialogPortal } from '../navigation/navigation-dialog-portal';
import { organizationErrorTextOf } from './errors';
import { organizationQueryKeys } from './keys';
import { ModalDialog } from './ui';
import { messages } from './knowledge-base-projects.messages';

export function KnowledgeBaseProjectsMenuItem({ base, onOpen }: { base: KnowledgeBaseSummary; onOpen: () => void }) {
  const { t } = useTranslation(messages);
  const access = useKnowledgeAccessQuery(base.id, { enabled: base.source === 'server' });
  if (base.source !== 'local' && access.data?.role !== 'owner') return null;
  return <DropdownMenuItem onSelect={onOpen}><Folders weight="duotone" aria-hidden />{t('availableProjects')}</DropdownMenuItem>;
}

export function KnowledgeBaseProjectsDialog({ base, onClose }: { base: KnowledgeBaseSummary; onClose: () => void }) {
  const { t } = useTranslation(messages);
  const local = useLocalLibrary();
  const scope = useQuery({
    queryKey: organizationQueryKeys.knowledgeBaseProjects(base.id),
    queryFn: ({ signal }) => knowledgeCatalogClient.getKnowledgeBaseProjects(base.id, signal),
    enabled: base.source === 'server',
  });
  const projectIds = base.source === 'local'
    ? local.library.bases.find((item) => item.id === base.id)?.projectIds
    : scope.data?.projectIds;
  return <NavigationDialogPortal>
    {projectIds ? <ProjectScopeForm base={base} initialProjectIds={projectIds} onClose={onClose} /> :
      <ModalDialog open onClose={onClose} title={t('availableProjects')} footer={<Button variant="outline" onClick={onClose}>{t('cancel')}</Button>}>
        {scope.isError ? <AppAlert tone="error" title={t('loadError')} description={organizationErrorTextOf(scope.error)} action={<Button variant="outline" onClick={() => void scope.refetch()}>{t('retry')}</Button>} />
          : <p role="status" className="text-[12px] text-[var(--muted)]">{t('loading')}</p>}
      </ModalDialog>}
  </NavigationDialogPortal>;
}

function ProjectScopeForm({ base, initialProjectIds, onClose }: { base: KnowledgeBaseSummary; initialProjectIds: string[]; onClose: () => void }) {
  const { t } = useTranslation(messages);
  const { projects } = useProjectResources();
  const { store } = useLocalLibrary();
  const { notify } = useAppAlert();
  const queryClient = useQueryClient();
  const [projectIds, setProjectIds] = useState(initialProjectIds);
  const choices = projects.filter((project) => project.source === base.source);
  const save = useMutation({
    mutationFn: async () => {
      if (base.source === 'server') return knowledgeCatalogClient.setKnowledgeBaseProjects(base.id, projectIds);
      if (!store) throw new Error(t('localSaveError'));
      store.update((library) => ({ ...library, bases: library.bases.map((item) => item.id === base.id ? { ...item, projectIds } : item) }));
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: organizationQueryKeys.knowledgeBases }),
        queryClient.invalidateQueries({ queryKey: organizationQueryKeys.knowledgeBaseProjects(base.id) }),
      ]);
      notify('success', t('updated'));
      onClose();
    },
  });
  const close = () => { if (!save.isPending) onClose(); };
  return <ModalDialog open onClose={close} title={t('availableProjects')} description={base.name} footer={<>
    <Button variant="outline" onClick={close} disabled={save.isPending}>{t('cancel')}</Button>
    <Button loading={save.isPending} onClick={() => save.mutate()}>{t('save')}</Button>
  </>}>
    <p className="text-[12px] leading-5 text-[var(--muted)]">{t('accessHint')}</p>
    <div className="max-h-[280px] overflow-y-auto rounded-md border border-[var(--control-border)] p-1">
      {choices.map((project) => <label key={project.id} className="fob-menu-item flex min-h-9 cursor-pointer items-center gap-2.5 rounded px-2 text-[12px]">
        <input type="checkbox" checked={projectIds.includes(project.id)} disabled={save.isPending} className="size-3.5 cursor-pointer accent-[var(--ink)]" onChange={(event) => setProjectIds((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} />
        <span className="min-w-0 truncate">{project.name}</span>
      </label>)}
      {!choices.length ? <p className="px-2 py-5 text-center text-[12px] text-[var(--muted)]">{t('noProjects')}</p> : null}
    </div>
    {save.isError ? <AppAlert tone="error" title={base.source === 'server' ? organizationErrorTextOf(save.error) : t('localSaveError')} /> : null}
  </ModalDialog>;
}
