import { AuthLoading } from '@/features/identity/components/auth-loading';
import { Suspense } from 'react';
import type { Metadata } from 'next';

import { OAuthCallbackScene } from '@/features/identity';

export const metadata: Metadata = {
  title: '企业登录 · Fob',
};

function OAuthCallbackFallback() {
  return <AuthLoading stage="callback" />;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<OAuthCallbackFallback />}>
      <OAuthCallbackScene />
    </Suspense>
  );
}
