import { AuthLoading } from '@/features/identity/components/auth-loading';
import { Suspense } from 'react';
import type { Metadata } from 'next';

import { AuthEntryScene } from '@/features/identity';

export const metadata: Metadata = {
  title: '登录 · Fob',
};

/** Pre-render fallback: the static stage without client-only search params. */
function AuthEntryFallback() {
  return <AuthLoading stage="entry" />;
}

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthEntryFallback />}>
      <AuthEntryScene />
    </Suspense>
  );
}
