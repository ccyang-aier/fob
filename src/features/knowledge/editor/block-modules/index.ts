import type { Extensions } from '@tiptap/core';
import type { EditorBlockContext, EditorBlockModule } from './types';
import { ParagraphModule } from './paragraph';
import { HeadingModule } from './heading';
import { BulletListModule } from './bullet-list';
import { OrderedListModule } from './ordered-list';
import { TaskListModule } from './task-list';
import { BlockquoteModule } from './blockquote';
import { CalloutModule } from './callout';
import { CodeBlockModule } from './code-block';
import { MathModule } from './math';
import { HorizontalRuleModule } from './horizontal-rule';
import { TableModule } from './table';
import { ColumnsModule } from './columns';
import { ImageModule } from './image';
import { VideoModule } from './video';
import { AudioModule } from './audio';
import { FileModule } from './file';
import { EmbedModule } from './embed';
import { BlockReferenceModule } from './block-reference';
import { PageLinkModule } from './page-link';
import { DatabaseViewModule } from './database-view';
import { AiBlockModule } from './ai-block';

/** One explicit manifest; each module owns its browser insert command and optional NodeView. */
export const EDITOR_BLOCK_MODULES: readonly EditorBlockModule[] = [
  ParagraphModule,
  HeadingModule(),
  BulletListModule,
  OrderedListModule,
  TaskListModule(),
  BlockquoteModule,
  CalloutModule,
  CodeBlockModule,
  MathModule,
  HorizontalRuleModule,
  TableModule,
  ColumnsModule,
  ImageModule,
  VideoModule,
  AudioModule,
  FileModule,
  EmbedModule,
  BlockReferenceModule,
  PageLinkModule,
  DatabaseViewModule,
  AiBlockModule,
];

export const editorBlockModuleByName = new Map(
  EDITOR_BLOCK_MODULES.map((module) => [module.name, module]),
);

/** Browser decoration of the shared schema; the registry itself stays transport-neutral. */
export function applyEditorBlockModules(
  extensions: Extensions,
  context: EditorBlockContext = {},
): Extensions {
  return EDITOR_BLOCK_MODULES.reduce(
    (current, module) => module.decorate?.(current, context) ?? current,
    extensions,
  );
}
