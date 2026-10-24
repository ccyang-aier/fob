'use client';

import { createTranslator } from '@/lib/i18n/messages';
import { messages } from './i18n/identity-provider.messages';
const uiText = createTranslator(messages);

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { sessionExpiredEvent } from '@/lib/authenticated-fetch';
import { createIdentitySessionStore, type IdentitySession } from './session-store';
import { authErrorCopyFor } from './auth-errors';
import { AccountDialog } from './components/account-dialog';
import { useAppAlert } from '@/components/app-alert-provider';
import { createPresenceStore } from './presence-store';
import type { PresencePreference, PresenceStatus } from './presence';
import { presenceDisplay } from './presence';

type IdentityContextValue = {
  session: IdentitySession;
  refresh: () => Promise<IdentitySession>;
  completeSignIn: () => Promise<void>;
  signOut: () => Promise<void>;
  expireSession: () => void;
  openSignIn: () => void;
  openSwitchAccount: () => void;
  presence: PresenceStatus;
  presencePreference: PresencePreference;
  setPresence: (value: PresencePreference) => void;
};
const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createIdentitySessionStore);
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const userId = session.status === 'authenticated' ? session.user.id : null;
  const presenceStore = useMemo(() => createPresenceStore(userId), [userId]);
  const presence = useSyncExternalStore(
    presenceStore.subscribe,
    presenceStore.getSnapshot,
    presenceStore.getServerSnapshot,
  );
  const [dialogMode, setDialogMode] = useState<'account' | 'switch-account' | null>(null);
  const { notify } = useAppAlert();
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    void store.refresh();
    const onFocus = () => {
      void store.refresh();
    };
    const onExpired = () => {
      if (store.getSnapshot().status === 'authenticated') {
        store.expire();
        notify('warning', uiText('登录已过期，请重新登录'));
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener(sessionExpiredEvent, onExpired);
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('fob.identity');
      channel.current.onmessage = () => {
        void store.refresh(true);
      };
    }
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(sessionExpiredEvent, onExpired);
      channel.current?.close();
    };
  }, [store, notify]);
  useEffect(() => {
    if (session.status !== 'authenticated') return;
    const timer = window.setTimeout(
      () => {
        void store.refresh(true);
      },
      Math.min(Math.max(0, Date.parse(session.expiresAt) - Date.now()), 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [session, store]);
  const closeDialog = useCallback(() => setDialogMode(null), []);
  const refresh = useCallback(() => store.refresh(true), [store]);
  const openSignIn = useCallback(() => setDialogMode('account'), []);
  const openSwitchAccount = useCallback(() => setDialogMode('switch-account'), []);
  const completeSignIn = useCallback(async () => {
    const previous = store.getSnapshot();
    const user = await store.completeSignIn();
    const switched = previous.status === 'authenticated' && previous.user.id !== user.id;
    notify(
      'success',
      switched
        ? uiText('已切换账户：{0}', { '0': user.name })
        : uiText('欢迎回来，{0}', { '0': user.name }),
    );
    setDialogMode(null);
    channel.current?.postMessage('session-changed');
  }, [store, notify]);
  const signOut = useCallback(async () => {
    try {
      await store.signOut();
      notify('success', uiText('已安全退出账户'));
      setDialogMode(null);
      channel.current?.postMessage('session-changed');
    } catch (error) {
      notify('error', authErrorCopyFor(error).description);
      throw error;
    }
  }, [store, notify]);
  const expireSession = useCallback(() => {
    store.expire();
    notify('warning', uiText('登录已过期，请重新登录'));
  }, [store, notify]);
  const setPresence = useCallback(
    (preference: PresencePreference) => {
      if (presenceStore.getSnapshot().preference === preference) return;
      presenceStore.setPreference(preference);
      const status = presenceDisplay(preference);
      notify('success', uiText('状态已设为「{0}」', { '0': status.label }), undefined, {
        markerColor: status.color,
      });
    },
    [presenceStore, notify],
  );
  const value = useMemo<IdentityContextValue>(
    () => ({
      session,
      refresh,
      openSignIn,
      openSwitchAccount,
      completeSignIn,
      signOut,
      expireSession,
      presence: presence.status,
      presencePreference: presence.preference,
      setPresence,
    }),
    [
      session,
      refresh,
      openSignIn,
      openSwitchAccount,
      completeSignIn,
      signOut,
      expireSession,
      presence,
      setPresence,
    ],
  );
  return (
    <IdentityContext.Provider value={value}>
      {children}
      <AccountDialog
        open={dialogMode !== null}
        switchingAccount={dialogMode === 'switch-account'}
        onClose={closeDialog}
      />
    </IdentityContext.Provider>
  );
}

export function useIdentity() {
  const value = useContext(IdentityContext);
  if (!value) throw new Error('IdentityProvider must wrap the Fob application.');
  return value;
}
