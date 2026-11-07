'use client';

import { createContext, useContext } from 'react';
import type * as Y from 'yjs';
import type { BlockEdits } from '@fob/shared/knowledge/collaboration';
import type { DocumentLinkTarget } from './document-link';

export type BlockEditSource = { document?: Y.Doc; entries?: BlockEdits };
export const BlockMenuContext = createContext<(BlockEditSource & { target: DocumentLinkTarget }) | null>(null);
export const useBlockMenuContext = () => useContext(BlockMenuContext);
