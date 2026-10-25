'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellSimple as Bell, BellSlash as BellOff } from '@phosphor-icons/react';
import { knowledgeSubscriptionResultSchema, type KnowledgeSubscriptionTarget } from '@fob/shared/knowledge/subscriptions';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ButtonLoading } from '@/components/ui/button-loading';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { knowledgeResourceRequest } from '../data/resource-http';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';
import { messages } from './messages';

export function SubscriptionMenuItem({ target, source, className }: { target: KnowledgeSubscriptionTarget; source: 'local' | 'server'; className?: string }) {
  const { t } = useTranslation(messages);
  return source === 'local' ? <DropdownMenuItem className={className} disabled title={t('unavailable')}><Bell size={16} weight="fill" aria-hidden />{t('subscribe')}</DropdownMenuItem> : <ServerSubscriptionMenuItem target={target} source={source} className={className} />;
}

function ServerSubscriptionMenuItem({ target, source, className }: { target: KnowledgeSubscriptionTarget; source: 'server'; className?: string }) {
  const { t } = useTranslation(messages);
  const { principal } = useKnowledgeBaseResources();
  const { notify } = useAppAlert();
  const client = useQueryClient();
  const { knowledgeBaseId, ...resource } = target;
  const queryKey = ['knowledge', knowledgeBaseId, 'subscription', principal, resource];
  const params = new URLSearchParams(resource);
  const query = useQuery({ queryKey, enabled: source === 'server' && principal !== 'guest', queryFn: ({ signal }) => knowledgeResourceRequest(knowledgeBaseId, `subscriptions?${params}`, knowledgeSubscriptionResultSchema, { signal }) });
  const mutation = useMutation({ mutationFn: () => knowledgeResourceRequest(knowledgeBaseId, 'subscriptions', knowledgeSubscriptionResultSchema, { method: query.data?.subscribed ? 'DELETE' : 'POST', body: JSON.stringify(resource) }), onSuccess: result => { client.setQueryData(queryKey, result); notify('success', t(result.subscribed ? 'subscribed' : 'unsubscribed')); }, onError: error => notify('error', error instanceof Error ? error.message : t('failed')) });
  const subscribed = query.data?.subscribed ?? false;
  const Icon = subscribed ? BellOff : Bell;
  const available = source === 'server' && principal !== 'guest';
  return <DropdownMenuItem className={className} disabled={!available || mutation.isPending || (query.isPending && !query.isError)} title={!available ? t('unavailable') : undefined} onSelect={event => { event.preventDefault(); if (query.isError) void query.refetch(); else mutation.mutate(); }}>
    {mutation.isPending ? <span className="flex size-4 items-center justify-center"><ButtonLoading /></span> : <Icon size={16} weight="fill" aria-hidden />}
    {t(query.isError ? 'retry' : available && query.isPending ? 'loading' : subscribed ? 'unsubscribe' : 'subscribe')}
  </DropdownMenuItem>;
}

export function FolderSubscriptionMenuItem({ folderId }: { folderId: string }) {
  const { selectedKnowledgeBase: base } = useKnowledgeBaseResources();
  return base?.source === 'server' ? <SubscriptionMenuItem target={{ knowledgeBaseId: base.id, teamspaceId: folderId }} source="server" /> : null;
}
