import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { eq } from 'drizzle-orm';
import {
  agentCreatePageToolInputSchema,
  agentSuggestDeleteToolInputSchema,
  agentSuggestInsertToolInputSchema,
  agentSuggestReplaceToolInputSchema,
  agentUpdatePagePropertiesToolInputSchema,
} from '@fob/shared/knowledge/contracts';
import type { SuggestionMetadata, NodeAnnotation } from '@fob/shared/knowledge/schema/suggestions';
import { newSuggestion } from '@fob/shared/knowledge/schema/suggestions';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { createMarkdownPipeline } from '@fob/shared/knowledge/markdown';
import { docState } from '../../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { authorizePageAccess } from '../../permissions/authorization';
import { pageDocumentName } from '@fob/shared/knowledge/collaboration';
import { PAGE_BODY_FRAGMENT, insertProseMirrorBlocks } from '../../import-export/y-encoding';
import { agentOrigin, mcpOrigin } from '@fob/shared/knowledge/collaboration';
import { appendKnowledgeOutbox } from '../../workers/outbox';
import { createAuthorizedPage, updateAuthorizedPage } from '../../pages/tree';
import { defineKnowledgeAgentTool } from './registry';
import { KnowledgeAgentToolError } from './errors';
import type { KnowledgeAgentWriteContext } from './types';

const pipeline = createMarkdownPipeline();

/** S03-style attribution: agent identity rides the suggestion author field. */
// The shared origin grammar is the single source of truth (S01); the UI and
// the undo scope both parse suggestions through parseKnowledgeOrigin.
const suggestionAuthor = (context: KnowledgeAgentWriteContext) => context.agent.clientName
  ? mcpOrigin(context.agent.clientName, context.agent.taskId)
  : agentOrigin(context.agent.taskId);

function requireWriteContext(context: KnowledgeAgentWriteContext): void {
  if (!context.agent?.taskId) throw new KnowledgeAgentToolError('INVALID_TOOL_INPUT', 'write');
}

interface Located { parent: Y.XmlElement | Y.XmlFragment; index: number; element: Y.XmlElement }

function findBlockLocation(container: Y.XmlElement | Y.XmlFragment, blockId: string): Located | undefined {
  const children = container.toArray();
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.getAttribute('blockId') === blockId) return { parent: container, index, element: child };
    const nested = findBlockLocation(child, blockId);
    if (nested) return nested;
  }
  return undefined;
}

/** S01 storage convention: every element gains an annotation, every text run the mark. */
function markYSubtreeForDeletion(node: Y.XmlElement | Y.XmlText, metadata: SuggestionMetadata): void {
  if (node instanceof Y.XmlText) {
    if (node.length) node.applyDelta([{ retain: node.length, attributes: { suggestion_delete: metadata } }]);
    return;
  }
  const annotations = node.getAttribute('annotations') as unknown as NodeAnnotation[] | null;
  if (!annotations?.some((item) => item.type === 'suggestion_delete')) {
    node.setAttribute('annotations', [...(annotations ?? []), { type: 'suggestion_delete', attrs: metadata }] as never);
  }
  for (const child of node.toArray()) markYSubtreeForDeletion(child as Y.XmlElement | Y.XmlText, metadata);
}

/** Annotate proposed blocks at the ProseMirror level so the encoder persists both storage forms. */
function annotateProposedBlocks(nodes: ProseMirrorNode[], metadata: SuggestionMetadata): ProseMirrorNode[] {
  const annotation: NodeAnnotation = { type: 'suggestion_insert', attrs: metadata };
  const insertMark = knowledgeSchema.marks.suggestion_insert.create(metadata);
  const walk = (node: ProseMirrorNode): ProseMirrorNode => {
    if (node.isText && node.text != null) return knowledgeSchema.text(node.text, insertMark.addToSet(node.marks));
    const attrs: Record<string, unknown> = { ...node.attrs, annotations: [annotation] };
    if (node.type.spec.attrs?.blockId) attrs.blockId = randomUUID();
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => children.push(walk(child)));
    return node.type.createChecked(attrs, children);
  };
  return nodes.map(walk);
}

function parseMarkdownBlocks(markdown: string): ProseMirrorNode[] {
  const document = pipeline.parse(markdown);
  const blocks: ProseMirrorNode[] = [];
  document.forEach((block) => blocks.push(block));
  if (!blocks.length) throw new KnowledgeAgentToolError('INVALID_TOOL_INPUT', 'markdown');
  return blocks;
}

interface BodyScope { knowledgeBaseId: string; pageId: string }

/**
 * Loads the authoritative body under an edit-level ACL, applies one
 * suggestion mutation inside a Yjs transaction, then commits through the
 * collaboration host's direct connection when available - online editors
 * receive the update live and the host's persistence hooks write doc_state
 * plus the doc.changed outbox row with the agent actor. The headless fallback
 * writes the same two records directly. There is no second body store.
 */
async function withAgentBodyEdit(context: KnowledgeAgentWriteContext, scope: BodyScope, mutate: (fragment: Y.XmlFragment, author: string) => string): Promise<{ suggestionId: string }> {
  const loaded = await withKnowledgeBase(context.pool, scope.knowledgeBaseId, async (db) => {
    const decision = await authorizePageAccess(db, { userId: context.authority.userId, scope, required: 'edit' });
    if (decision.decision !== 'allow') throw new KnowledgeAgentToolError('TARGET_NOT_ACCESSIBLE', 'insert');
    const [row] = await db.select({ state: docState.state }).from(docState).where(eq(docState.pageId, scope.pageId));
    return row?.state ?? null;
  });

  const ydoc = new Y.Doc();
  if (loaded) Y.applyUpdate(ydoc, new Uint8Array(loaded));
  const baseVector = Y.encodeStateVector(ydoc);
  const author = suggestionAuthor(context);
  const suggestionId = ydoc.transact(() => mutate(ydoc.getXmlFragment(PAGE_BODY_FRAGMENT), author));
  const update = Y.encodeStateAsUpdate(ydoc, baseVector);
  const actor = context.agent.clientName
    ? { kind: 'mcp' as const, userId: context.authority.userId, taskId: context.agent.taskId, clientName: context.agent.clientName }
    : { kind: 'agent' as const, userId: context.authority.userId, taskId: context.agent.taskId };

  if (context.hocuspocus) {
    const connection = await context.hocuspocus.openDirectConnection(pageDocumentName(scope), { pageId: scope.pageId, actor });
    try {
      await connection.transact((document) => {
        Y.applyUpdate(document, update);
      });
    } finally {
      await connection.disconnect();
    }
  } else {
    const state = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    const stateVector = Buffer.from(Y.encodeStateVector(ydoc));
    await withKnowledgeBase(context.pool, scope.knowledgeBaseId, async (db) => {
      await db.insert(docState).values({ ...scope, state, stateVector })
        .onConflictDoUpdate({ target: [docState.knowledgeBaseId, docState.pageId], set: { state, stateVector, updatedAt: new Date() } });
      await appendKnowledgeOutbox(db, { topic: 'doc.changed', knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, actor, occurredAt: new Date().toISOString() });
    });
  }
  return { suggestionId };
}

export const knowledgeAgentWriteTools = [
  defineKnowledgeAgentTool({
    name: 'insert',
    description: '在锚点块之后(缺省文末)以可审阅建议的形式插入新块',
    scopes: ['write'],
    inputSchema: agentSuggestInsertToolInputSchema,
    async handler(input, context) {
      requireWriteContext(context as KnowledgeAgentWriteContext);
      const write = context as KnowledgeAgentWriteContext;
      return withAgentBodyEdit(write, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId }, (fragment, author) => {
        const suggestion = newSuggestion(author);
        const blocks = annotateProposedBlocks(parseMarkdownBlocks(input.markdown), suggestion);
        const anchor = input.afterBlockId ? findBlockLocation(fragment, input.afterBlockId) : undefined;
        if (input.afterBlockId && !anchor) throw new KnowledgeAgentToolError('TARGET_NOT_ACCESSIBLE', 'insert');
        insertProseMirrorBlocks(anchor ? anchor.parent : fragment, anchor ? anchor.index + 1 : fragment.length, blocks);
        return suggestion.suggestionId;
      });
    },
  }),
  defineKnowledgeAgentTool({
    name: 'replace',
    description: '以可审阅建议替换单个块:原块标记删除,新内容并行插入',
    scopes: ['write'],
    inputSchema: agentSuggestReplaceToolInputSchema,
    async handler(input, context) {
      requireWriteContext(context as KnowledgeAgentWriteContext);
      const write = context as KnowledgeAgentWriteContext;
      return withAgentBodyEdit(write, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId }, (fragment, author) => {
        const location = findBlockLocation(fragment, input.blockId);
        if (!location) throw new KnowledgeAgentToolError('TARGET_NOT_ACCESSIBLE', 'delete');
        const suggestion = newSuggestion(author);
        markYSubtreeForDeletion(location.element, suggestion);
        insertProseMirrorBlocks(location.parent, location.index + 1, annotateProposedBlocks(parseMarkdownBlocks(input.markdown), suggestion));
        return suggestion.suggestionId;
      });
    },
  }),
  defineKnowledgeAgentTool({
    name: 'delete',
    description: '以可审阅建议删除单个块;审阅接受前内容保留',
    scopes: ['write'],
    inputSchema: agentSuggestDeleteToolInputSchema,
    async handler(input, context) {
      requireWriteContext(context as KnowledgeAgentWriteContext);
      const write = context as KnowledgeAgentWriteContext;
      return withAgentBodyEdit(write, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId }, (fragment, author) => {
        const location = findBlockLocation(fragment, input.blockId);
        if (!location) throw new KnowledgeAgentToolError('TARGET_NOT_ACCESSIBLE', 'delete');
        const suggestion = newSuggestion(author);
        markYSubtreeForDeletion(location.element, suggestion);
        return suggestion.suggestionId;
      });
    },
  }),
  defineKnowledgeAgentTool({
    name: 'create_page',
    description: '创建新页面(可在父页面之下),含标题/图标/封面;父页面要求 edit 级授权',
    scopes: ['write'],
    inputSchema: agentCreatePageToolInputSchema,
    async handler(input, context) {
      requireWriteContext(context as KnowledgeAgentWriteContext);
      const write = context as KnowledgeAgentWriteContext;
      return withKnowledgeBase(write.pool, input.knowledgeBaseId, async (db) => {
        if (input.parentId) {
          const decision = await authorizePageAccess(db, { userId: write.authority.userId, scope: { knowledgeBaseId: input.knowledgeBaseId, pageId: input.parentId }, required: 'edit' });
          if (decision.decision !== 'allow') throw new KnowledgeAgentToolError('TARGET_NOT_ACCESSIBLE', 'create_page');
        }
        return createAuthorizedPage(db, {
          id: randomUUID(), knowledgeBaseId: input.knowledgeBaseId, teamspaceId: input.teamspaceId, parentId: input.parentId,
          title: input.title, kind: input.kind, databaseId: null, properties: {}, icon: input.icon ?? null, cover: input.cover ?? null,
          inheritsPermissions: true, afterPageId: input.afterPageId ?? null,
        }, write.authority.userId);
      });
    },
  }),
  defineKnowledgeAgentTool({
    name: 'update_properties',
    description: '更新页面元数据(标题/图标/封面);要求页面 edit 级授权',
    scopes: ['write'],
    inputSchema: agentUpdatePagePropertiesToolInputSchema,
    async handler(input, context) {
      requireWriteContext(context as KnowledgeAgentWriteContext);
      const write = context as KnowledgeAgentWriteContext;
      return withKnowledgeBase(write.pool, input.knowledgeBaseId, async (db) => {
        const decision = await authorizePageAccess(db, { userId: write.authority.userId, scope: { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId }, required: 'edit' });
        if (decision.decision !== 'allow') throw new KnowledgeAgentToolError('TARGET_NOT_ACCESSIBLE', 'update_properties');
        return updateAuthorizedPage(db, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId, patch: input.patch }, write.authority.userId);
      });
    },
  }),
] as const;
