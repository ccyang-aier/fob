'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClient, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import type { CoffeeSummary } from '@fob/shared/rewards';
import { useIdentity } from '@/features/identity/identity-provider';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n/react';
import { rewardsApi, RewardsError } from './rewards-api';
import { rewardsMessages } from './rewards.messages';

type RewardsContextValue = {
  accountId: string | null;
  principal: string;
  identityStatus: 'checking' | 'anonymous' | 'error' | 'authenticated';
  summary: CoffeeSummary | undefined;
  loading: boolean;
  error: unknown;
  checkingIn: boolean;
  checkIn: () => Promise<void>;
  refresh: () => void;
  openSignIn: () => void;
  client: QueryClient;
};
const Context = createContext<RewardsContextValue | null>(null);
const summaryKey = (principal: string) => ['rewards', principal, 'coffee'] as const;
const ledgerKey = (principal: string) => ['rewards', principal, 'ledger'] as const;

/** One in-memory account cache. It never writes a balance to browser storage. */
export function RewardsProvider({ children }: { children: ReactNode }) {
  const { session, openSignIn, refresh: refreshIdentity } = useIdentity();
  const { notify } = useAppAlert();
  const { t } = useTranslation(rewardsMessages);
  const accountId = session.status === 'authenticated' ? session.user.id : null;
  const principal = session.status === 'authenticated' ? `${session.user.id}:${session.expiresAt}` : session.status;
  const [client] = useState(() => new QueryClient());
  const scope = useMemo(() => ({ principal }), [principal]);
  const activeScope = useRef<typeof scope | null>(null);
  useEffect(() => {
    activeScope.current = scope;
    return () => {
      if (activeScope.current === scope) activeScope.current = null;
      void client.cancelQueries({ queryKey: ['rewards', scope.principal] });
      client.removeQueries({ queryKey: ['rewards', scope.principal] });
      for (const pending of client.getMutationCache().findAll({ mutationKey: ['rewards', scope.principal] })) client.getMutationCache().remove(pending);
    };
  }, [client, scope]);
  const query = useQuery({
    queryKey: summaryKey(principal), enabled: accountId !== null,
    queryFn: ({ signal }) => rewardsApi.summary(accountId!, signal),
    staleTime: 30_000, refetchInterval: 60_000, retry: false,
  }, client);
  const mutation = useMutation({
    mutationKey: ['rewards', principal, 'check-in'],
    mutationFn: (input: { accountId: string; scope: typeof scope }) => rewardsApi.checkIn(input.accountId),
    onSuccess: (result, input) => {
      if (activeScope.current !== input.scope || result.accountId !== input.accountId) return;
      const { awarded, reward: _reward, ...summary } = result;
      void _reward;
      client.setQueryData(summaryKey(input.scope.principal), summary);
      void client.invalidateQueries({ queryKey: ledgerKey(input.scope.principal) });
      notify('success', t(awarded ? 'collected' : 'checkedIn'));
    },
    onError: (error, input) => {
      if (activeScope.current !== input.scope) return;
      notify('error', t(error instanceof RewardsError && error.code === 'ACCOUNT_CHANGED' ? 'accountChanged' : 'failed'));
    },
  }, client);
  const currentMutation = mutation.variables?.scope === scope;
  const failure = query.error ?? (currentMutation ? mutation.error : null);
  useEffect(() => {
    if (failure instanceof RewardsError && (failure.code === 'ACCOUNT_CHANGED' || failure.code === 'UNAUTHENTICATED')) {
      client.removeQueries({ queryKey: ['rewards'] });
      void refreshIdentity();
    }
  }, [failure, client, refreshIdentity]);
  const summary = query.data?.accountId === accountId ? query.data : undefined;
  useEffect(() => {
    if (!summary) return;
    const wait = Date.parse(`${summary.today}T16:00:00.000Z`) - Date.parse(summary.serverTime);
    const timer = window.setTimeout(() => { void client.invalidateQueries({ queryKey: summaryKey(principal) }); }, Math.max(100, wait + 150));
    return () => window.clearTimeout(timer);
  }, [summary, principal, client]);
  const checkIn = useCallback(async () => {
    if (!accountId) { openSignIn(); return; }
    if ((currentMutation && mutation.isPending) || summary?.checkedInToday) return;
    try { await mutation.mutateAsync({ accountId, scope }); } catch { /* Mutation publishes the shared AppAlert. */ }
  }, [accountId, scope, openSignIn, mutation, currentMutation, summary?.checkedInToday]);
  const value: RewardsContextValue = {
    accountId, principal, identityStatus: session.status, summary,
    loading: accountId !== null && query.isPending,
    error: failure, checkingIn: currentMutation && mutation.isPending, checkIn,
    refresh: () => { mutation.reset(); void query.refetch(); }, openSignIn, client,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCoffeeRewards() {
  const value = useContext(Context);
  if (!value) throw new Error('RewardsProvider is required.');
  return value;
}

export function useCoffeeLedger() {
  const { accountId, principal, client } = useCoffeeRewards();
  return useInfiniteQuery({
    queryKey: ledgerKey(principal), enabled: accountId !== null,
    queryFn: ({ signal, pageParam }) => rewardsApi.ledger(accountId!, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: page => page.nextCursor,
    retry: false,
  }, client);
}
