'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { ChatCircleDots, Coffee, ThumbsUp, ThumbsUpOutline } from '@/components/icons';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { useCoffeeRewards } from '@/features/rewards';
import { usePageCommentThreads } from '../../../comments/comments-queries';
import { documentInteractionsApi } from './api';
import { InteractionButton } from './interaction-button';
import { CoffeeGiftDialog } from './coffee-gift-dialog';
import { interactionMessages } from './messages';
import styles from './styles.module.css';

export function DocumentInteractions({ scope, commentsOpen, onComments }: { scope: PageScope; commentsOpen: boolean; onComments(): void }) {
  const { t } = useTranslation(interactionMessages), { notify } = useAppAlert(), rewards = useCoffeeRewards(), client = useQueryClient();
  const key = [scope.knowledgeBaseId, 'document-interactions', scope.pageId, rewards.accountId];
  const data = useQuery({ queryKey: key, queryFn: ({ signal }) => documentInteractionsApi.read(scope, signal), enabled: !!rewards.accountId, refetchInterval: 30_000 });
  const comments = usePageCommentThreads(scope.knowledgeBaseId, scope.pageId);
  const [dialog, setDialog] = useState(false), [busy, setBusy] = useState(false);
  const [likeSequence, setLikeSequence] = useState(0), [coffeeSequence, setCoffeeSequence] = useState(0), [commentSequence, setCommentSequence] = useState(0);
  const liking = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function like() {
    if (liking.current) return;
    if (!data.data) { void data.refetch(); return; }
    liking.current = true; setBusy(true);
    const wanted = !data.data.liked;
    try { const result = await documentInteractionsApi.like(scope, wanted); if (!active.current) return; client.setQueryData(key, result); if (wanted) setLikeSequence(value => value + 1); void client.invalidateQueries({ queryKey: ['knowledge',scope.knowledgeBaseId,'personal-profile'] }); }
    catch { if (active.current) notify('error', t('failed')); }
    finally { liking.current = false; if (active.current) setBusy(false); }
  }
  return <div className={styles.group} aria-label={t('comments')}>
    <InteractionButton effect="like" label={data.isError ? t('unavailable') : t(data.data?.liked ? 'unlike' : 'like')} active={data.data?.liked} count={data.data?.likes} disabled={!rewards.accountId || data.isPending} busy={busy} sequence={likeSequence} onClick={() => void like()}>{data.data?.liked ? <ThumbsUp size={16} /> : <ThumbsUpOutline size={16} />}</InteractionButton>
    <InteractionButton effect="coffee" label={data.data && !data.data.canGift ? t('selfGift') : t('coffee')} count={data.data?.coffeeTotal} disabled={!rewards.accountId || data.isPending || data.data?.canGift === false} sequence={coffeeSequence} onClick={() => { if (data.data) { rewards.refresh(); setDialog(true); } else void data.refetch(); }}><Coffee size={16} /></InteractionButton>
    <InteractionButton effect="comment" label={t(commentsOpen ? 'closeComments' : 'comments')} active={commentsOpen} count={comments.data?.length} sequence={commentSequence} onClick={() => { setCommentSequence(value => value + 1); onComments(); }}><ChatCircleDots size={16} /></InteractionButton>
    {dialog && data.data && <CoffeeGiftDialog key={`${scope.knowledgeBaseId}:${scope.pageId}:${rewards.accountId}`} scope={scope} recipient={data.data.recipient} onClose={() => setDialog(false)} onSent={amount => {
      setDialog(false); setCoffeeSequence(value => value + 1); void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ['knowledge',scope.knowledgeBaseId,'personal-profile'] });
      notify('success', t('sent', { name: data.data!.recipient.name, count: amount }));
    }} />}
  </div>;
}
