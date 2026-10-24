'use client';

import { UserCircle } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { CanvasState } from '../canvas-states';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';
import { OrganizationPanel } from './organization-panel';
import { messages } from './knowledge-members-page.messages';

/** Member management always belongs to the same knowledge base selected in the app header. */
export function KnowledgeMembersPage() {
  const { t } = useTranslation(messages);
  const { selectedKnowledgeBase, scopeKey } = useKnowledgeBaseResources();
  if (!selectedKnowledgeBase) return <CanvasState title={t('selectKnowledgeBase')} hint={t('selectKnowledgeBaseHint')} />;
  if (selectedKnowledgeBase.source === 'server') {
    return <OrganizationPanel key={scopeKey} knowledgeBaseId={selectedKnowledgeBase.id} />;
  }
  return <section className="flex h-full min-h-0 flex-col" aria-label={t('members')}>
    <header className="shrink-0 px-8 pb-5 pt-8"><h1 className="text-[22px] font-semibold text-[var(--ink)]">{t('members')}</h1></header>
    <CanvasState className="min-h-0 flex-1" icon={<UserCircle size={32} weight="duotone" aria-hidden />} title={t('personalKnowledgeBase')} hint={t('personalOnly')} />
  </section>;
}
