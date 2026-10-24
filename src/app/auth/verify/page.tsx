import { AuthLoading } from '@/features/identity/components/auth-loading';
import { Suspense } from 'react';
import type { Metadata } from 'next';

import { VerifyEmailScene } from '@/features/identity';

export const metadata: Metadata = {
  title: '邮箱验证 · Fob',
};

function VerifyEmailFallback() {
  return <AuthLoading stage="verify" />;
}

export default function AuthVerifyPage() {
  return (
    <Suspense fallback={<VerifyEmailFallback />}>
      <VerifyEmailScene />
    </Suspense>
  );
}
