'use client';

import { useState } from 'react';
import type { PersonalProfile } from '@fob/shared/knowledge/contracts';
import { DotsThree, User, LinkSimple, ArrowClockwise, CheckCircle } from '@/components/icons';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAppAlert } from '@/components/app-alert-provider';
import { useIdentity } from '../identity-context';
import { presenceDisplay } from '../presence';
import { AccountProfile } from '../components/account-profile';
import { useTranslation } from '@/lib/i18n';
import { messages } from './messages';
import styles from './profile.module.css';

export function ProfileHeader({ data, scope, onRefresh }: { data?: PersonalProfile; scope?: string; onRefresh: () => void }) {
  const { session, presence } = useIdentity();
  const { t, locale } = useTranslation(messages);
  const { notify } = useAppAlert();
  const [editing, setEditing] = useState(false);
  if (session.status !== 'authenticated') return null;
  const user = session.user, status = presenceDisplay(presence, locale);

  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); notify('success', t('copied')); }
    catch { notify('error', t('copyFailed')); }
  }

  return (
    <>
      <header className={styles.header}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={styles.portrait} tabIndex={0} aria-label={t('liveStatus', { status: status.label })}>
              <UserAvatar name={user.name} image={user.image} className={styles.avatar} />
              <span className={styles.presence} style={{ backgroundColor: status.color }} aria-hidden />
            </div>
          </TooltipTrigger>
          <TooltipContent>{status.label}</TooltipContent>
        </Tooltip>
        <div className={styles.identity}>
          <h1>{user.name}</h1>
          <p className={styles.handle}>
            <span>@{user.email.split('@')[0]}</span>
            {user.emailVerified ? <Tooltip><TooltipTrigger asChild><span tabIndex={0} aria-label={t('verified')}><CheckCircle size={14} aria-hidden /></span></TooltipTrigger><TooltipContent>{t('verified')}</TooltipContent></Tooltip> : null}
          </p>
          {scope ? <p className={styles.scope}>{scope}</p> : null}
        </div>
        <div className={styles.headerSide}>
          <div className={styles.actions}>
            <Button variant="outline" className={styles.editButton} onClick={() => setEditing(true)} aria-haspopup="dialog"><User size={16} aria-hidden />{t('edit')}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="icon" className={styles.moreButton} aria-label={t('more')}><DotsThree size={18} aria-hidden /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void copyLink()}><LinkSimple size={16} />{t('copy')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={onRefresh}><ArrowClockwise size={16} />{t('refresh')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <dl className={styles.stats}>
            <div className={styles.stat}><dt>{t('documents')}</dt><dd>{data?.documentTotal ?? '—'}</dd></div>
            <div className={styles.stat}><dt>{t('folders')}</dt><dd>{data?.folders.length ?? '—'}</dd></div>
          </dl>
        </div>
      </header>
      {editing ? <AccountProfile onClose={() => setEditing(false)} /> : null}
    </>
  );
}
