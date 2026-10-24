'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createKnowledgeQueryClient } from './query-client';

/**
 * Mounts the knowledge data layer's QueryClient. One client lives as long as
 * this provider; knowledge pages (U02+) compose under it.
 */
export function KnowledgeQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createKnowledgeQueryClient);
  useEffect(() => () => {
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
