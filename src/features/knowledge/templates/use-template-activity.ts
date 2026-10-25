'use client';

import { useLayoutEffect, useRef } from 'react';
import { usePageVisible } from '@/lib/page-visibility';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';

/** Finishing a background operation cannot take over a different tab or account. */
export function useTemplateActivity() {
  const visible = usePageVisible();
  const { scopeKey } = useKnowledgeBaseResources();
  const activity = useRef({ visible, live: true });
  useLayoutEffect(() => {
    const current = { visible, live: true };
    activity.current = current;
    return () => { current.live = false; };
  }, [visible, scopeKey]);
  return () => {
    const started = activity.current;
    return () => started.live && started.visible && activity.current === started;
  };
}
