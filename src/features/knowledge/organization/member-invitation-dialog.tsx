'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, LinkSimple } from '@/components/icons';
import { createKnowledgeBaseInvitationInputSchema } from '@fob/shared/knowledge/contracts';
import { useTranslation } from '@/lib/i18n';
import { organizationErrorTextOf } from './errors';
import { invitationClient, knowledgeBaseInvitationLink, type CreatedKnowledgeBaseInvitation } from './invitation-client';
import { organizationQueryKeys } from './keys';
import { ModalDialog, DialogButton } from './ui';
import type { MemberRow } from './list-mutations';
import { managementMessages } from './management.messages';
import styles from './management.module.css';

export function MemberInvitationDialog({ knowledgeBaseId, members, email: initialEmail, reissue, onClose, notify }: {
  knowledgeBaseId: string; members: MemberRow[]; email: string; reissue: boolean; onClose: () => void;
  notify: (kind: 'success' | 'error', message: string) => void;
}) {
  const { t } = useTranslation(managementMessages);
  const client = useQueryClient();
  const [email, setEmail] = useState(initialEmail);
  const [created, setCreated] = useState<CreatedKnowledgeBaseInvitation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  async function create() {
    if (pending.current) return;
    const input = createKnowledgeBaseInvitationInputSchema.safeParse({ knowledgeBaseId, email: email.trim() });
    if (!input.success) { setError(t('invalidEmail')); return; }
    if (members.some((member) => member.email.toLowerCase() === input.data.email)) { setError(t('alreadyMember')); return; }
    pending.current = true; setBusy(true); setError('');
    const abort = new AbortController(); controller.current = abort;
    try {
      const result = await invitationClient.create(knowledgeBaseId, input.data.email, abort.signal);
      if (abort.signal.aborted) return;
      setCreated(result);
      await client.invalidateQueries({ queryKey: organizationQueryKeys.invitations(knowledgeBaseId) });
    } catch (cause) { if (!abort.signal.aborted) notify('error', t('failed', { error: organizationErrorTextOf(cause) })); }
    finally { pending.current = false; if (!abort.signal.aborted) setBusy(false); }
  }
  const link = created && typeof window !== 'undefined' ? knowledgeBaseInvitationLink(window.location.origin, created) : '';
  return <ModalDialog open onClose={() => { if (!pending.current) onClose(); }} title={created ? t('invitationCreated') : t('invite')}
    footerStyle={{ paddingTop: created ? 12 : 16, paddingBottom: created ? 16 : 20 }}
    description={created ? t('linkHint') : t('invitationHint')}
    footer={<><DialogButton onClick={onClose} disabled={busy}>{created ? <Check size={16} aria-hidden /> : null}{created ? t('close') : t('cancel')}</DialogButton>
      {!created ? <DialogButton variant="primary" loading={busy} onClick={() => void create()}><LinkSimple size={16} aria-hidden />{reissue ? t('reissue') : t('createInvitation')}</DialogButton> : null}</>}>
    {created ? <label className={styles.field}>{t('invitationLink')}<div className={styles.link}>
      <input className={styles.input} readOnly value={link} aria-label={t('invitationLink')} onFocus={(event) => event.target.select()} />
      <DialogButton onClick={() => { void navigator.clipboard.writeText(link).then(() => notify('success', t('copied'))).catch((cause) => notify('error', t('failed', { error: organizationErrorTextOf(cause) }))); }}>{t('copyLink')}</DialogButton>
    </div></label> : <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <label className={styles.field}>{t('email')}<input autoFocus type="email" required autoComplete="email" className={styles.input} placeholder={t('emailPlaceholder')} value={email} disabled={busy}
        onChange={(event) => { setEmail(event.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={error ? 'invitation-email-error' : undefined} />
        {error ? <span id="invitation-email-error" className={styles.danger} role="alert">{error}</span> : null}</label>
      {reissue ? <p className={styles.notice}>{t('reissueWarning')}</p> : null}
      <button type="submit" hidden />
    </form>}
  </ModalDialog>;
}
