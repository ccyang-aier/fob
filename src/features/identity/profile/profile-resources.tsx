'use client';

import { useId, useState } from 'react';
import type { ProfileResource } from '@fob/shared/knowledge/contracts';
import { FileText, DotsThree, Star, StarOutline } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { AppAlert } from '@/components/app-alert';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SubscriptionMenuItem } from '@/features/knowledge/subscriptions/subscription-menu-item';
import { PageIcon } from '@/features/knowledge/navigation/page-icon';
import { useTranslation } from '@/lib/i18n';
import { profileTimeZone } from '@/features/knowledge/profile/profile-calendar';
import { messages } from './messages';
import styles from './profile.module.css';

export type ProfileResourceActions = {
  onOpen: (resource: Pick<ProfileResource, 'id' | 'kind'>) => void;
  onToggleStar: (resource: ProfileResource) => void;
  knowledgeBaseId: string;
  source: 'local' | 'server';
};

function ProfileDocumentRow({ resource, onOpen, onToggleStar, knowledgeBaseId, source }: ProfileResourceActions & { resource: ProfileResource }) {
  const { t, locale } = useTranslation(messages);
  const updated = new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, month: 'short', day: 'numeric' }).format(new Date(resource.updatedAt));

  return (
    <div className={'fob-action ' + styles.resourceRow} data-variant="group">
      <button type="button" className={'fob-action ' + styles.resourceMain} data-variant="group-item" onClick={() => onOpen(resource)} aria-label={t('openDocument', { title: resource.title })}>
        <span className={styles.resourceIcon}>{resource.icon ? <PageIcon value={resource.icon} size={24} /> : <FileText size={24} aria-hidden />}</span>
        <span className={styles.resourceText}>
          <span className={styles.resourceTitle}><strong>{resource.title}</strong>{resource.starred ? <Star size={14} className={styles.resourceStar} aria-hidden /> : null}</span>
          <span className={styles.resourceMetadata}><time dateTime={resource.updatedAt}>{t('updated', { date: updated })}</time>{resource.count > 0 ? <><span>·</span><span>{t('readCount', { count: resource.count })}</span></> : null}</span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" data-variant="group-item" aria-label={t('resourceActions', { title: resource.title })}><DotsThree size={18} /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onOpen(resource)}><FileText size={16} />{t('open')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onToggleStar(resource)}>{resource.starred ? <Star size={16} /> : <StarOutline size={16} />}{t(resource.starred ? 'unsave' : 'save')}</DropdownMenuItem>
          <SubscriptionMenuItem source={source} target={{ knowledgeBaseId, pageId: resource.id }} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function ProfileDocuments({ resources, total, nextOffset, onMore, loading, error, onRetry, ...actions }: ProfileResourceActions & {
  resources: ProfileResource[];
  total: number;
  nextOffset: number | null;
  onMore: () => void;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation(messages);
  const heading = useId();
  const [expanded, setExpanded] = useState(false);
  const canExpand = resources.length > 6 || nextOffset !== null;
  const displayed = expanded ? resources : resources.slice(0,6);

  return (
    <section className={styles.documentsColumn} aria-labelledby={heading} aria-busy={loading}>
      <div className={styles.documentsHeading}>
        <div><FileText size={18} aria-hidden /><h2 id={heading}>{t('myDocuments')}</h2><span>{total}</span></div>
        {canExpand ? <Button variant="ghost" size="sm" className={styles.seeMore} onClick={() => setExpanded(value => !value)}>{t(expanded ? 'showLess' : 'viewAll')}</Button> : null}
      </div>
      {displayed.length ? <div className={styles.documentRows}>{displayed.map(resource => <ProfileDocumentRow key={resource.id} resource={resource} {...actions} />)}</div> : <EmptyState className={styles.documentsEmpty} label={t('noDocuments')} description={t('noDocumentsHint')} />}
      {error ? <div className={styles.documentsError}><AppAlert tone="error" title={t('documentsFailed')} /><Button variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button></div> : expanded && nextOffset !== null ? <div className={styles.loadMore}><Button variant="outline" size="sm" loading={loading} onClick={onMore}>{t('moreDocuments')}</Button></div> : null}
    </section>
  );
}
