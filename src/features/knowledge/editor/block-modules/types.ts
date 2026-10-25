import type { ComponentType } from 'react';
import type { Editor, Extensions, JSONContent } from '@tiptap/core';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import type { ReferencePageChoice } from '../../data/reference-pages';

export type BlockInsertCommand = (editor: Editor) => boolean;
export type BlockIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
export interface EditorBlockContext { scope?: PageScope; knowledgeBaseId?: string; origin?: string; cacheIdentity?: string; localKnowledgeBaseId?: string; localPageId?: string; getLocalPages?: () => readonly (ReferencePageChoice & { body?: JSONContent })[]; subscribeLocalPages?: (listener: () => void) => () => void }

export interface BlockChoice {
  name: string;
  title: string;
  marker?: string;
  shortcut?: string;
  keywords?: readonly string[];
  insert: BlockInsertCommand;
}

/** Browser behavior owned by one shared-schema block. Protocol and persistence stay in shared/. */
export interface EditorBlockModule {
  name: string;
  icon: BlockIcon;
  insert: BlockInsertCommand;
  title?: string;
  shortcut?: string;
  choices?: readonly BlockChoice[];
  extensions?: Extensions;
  decorate?: (extensions: Extensions, context: EditorBlockContext) => Extensions;
}
