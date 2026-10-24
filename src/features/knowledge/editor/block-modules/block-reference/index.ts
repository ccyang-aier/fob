import { Link } from '@phosphor-icons/react';
import { insertAtom } from '../insert';
import type { EditorBlockModule } from '../types';
import { applyBlockReferenceView } from './block-reference';
import { applyLocalBlockReferenceView } from './local-block-reference';

export const BlockReferenceModule: EditorBlockModule = {
  name: 'blockReference', icon: Link,
  insert: insertAtom('blockReference'),
  decorate: (extensions, context) => context.scope
    ? applyBlockReferenceView(extensions, { scope: context.scope, origin: context.origin ?? '', cacheIdentity: context.cacheIdentity })
    : context.localKnowledgeBaseId && context.localPageId && context.getLocalPages && context.subscribeLocalPages
      ? applyLocalBlockReferenceView(extensions, { localKnowledgeBaseId: context.localKnowledgeBaseId, localPageId: context.localPageId, getLocalPages: context.getLocalPages, subscribeLocalPages: context.subscribeLocalPages })
      : extensions,
};
