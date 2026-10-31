'use client';

import { createContext, useContext } from 'react';
import type { IdentitySession } from './session-store';
import type { PresencePreference, PresenceStatus } from './presence';

export type IdentityContextValue = {
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

export const IdentityContext = createContext<IdentityContextValue | null>(null);

export function useIdentity() {
  const value = useContext(IdentityContext);
  if (!value) throw new Error('IdentityProvider must wrap the Fob application.');
  return value;
}
