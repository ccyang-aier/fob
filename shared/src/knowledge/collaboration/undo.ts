import * as Y from 'yjs';
import { parseKnowledgeOrigin } from './origin';
import type { AgentOrigin, HumanOrigin, McpOrigin } from './origin';

export type KnowledgeUndoScope = ConstructorParameters<typeof Y.UndoManager>[0];
type UndoOptions = NonNullable<ConstructorParameters<typeof Y.UndoManager>[1]>;
type StackItem = Y.UndoManager['undoStack'][number];

function validateScope(scope: KnowledgeUndoScope): void {
  const types = Array.isArray(scope) ? scope : [scope];
  const documents = types.map((type) => type instanceof Y.Doc ? type : type.doc);
  if (!documents.length || !documents[0] || documents.some((doc) => doc !== documents[0])) {
    throw new TypeError('Undo scope must belong to one live Y.Doc');
  }
}

/**
 * Selective text undo alone can still delete a parent containing somebody else's
 * text. Protect surviving XML children AND their block identity attributes.
 * Yjs deletes children before parents. Item/ContentType/isDeleted are exported
 * by the pinned Yjs version; the struct pointers are covered by replica tests.
 */
class KnowledgeUndoManager extends Y.UndoManager {
  private reverting: { live: StackItem[]; before: StackItem[] } | null = null;

  constructor(scope: KnowledgeUndoScope, options: UndoOptions) {
    validateScope(scope);
    super(scope, options);
    this.deleteFilter = (item) => this.canDeleteItem(item);
  }

  private wasInserted(item: Y.Item | null): boolean {
    const stack = this.reverting;
    // popStackItem may skip obsolete entries. Its current item is the entry
    // just removed, not necessarily the last item when undo() was invoked.
    const current = stack?.before[stack.live.length];
    return !!item && !!current && Y.isDeleted(current.insertions, item.id);
  }

  private hasForeignAttributes(element: Y.XmlElement): boolean {
    return [...element._map.values()].some((item) => !item.deleted && !this.wasInserted(item));
  }

  private canDeleteItem(item: Y.Item): boolean {
    if (item.parentSub !== null && item.parent instanceof Y.XmlElement && this.wasInserted(item.parent._item)) {
      // If the new block survives, its required attributes (notably blockId)
      // must survive too, including when the human change was attribute-only.
      if (item.parent.length > 0 || this.hasForeignAttributes(item.parent)) return false;
    }
    if (!(item.content instanceof Y.ContentType)) return true;
    const type = item.content.type;
    if (type instanceof Y.Text) return type.length === 0;
    if (type instanceof Y.XmlElement) return type.length === 0 && !this.hasForeignAttributes(type);
    if (type instanceof Y.XmlFragment) return type.length === 0;
    return true;
  }

  override undo(): StackItem | null {
    this.reverting = { live: this.undoStack, before: this.undoStack.slice() };
    try { return super.undo(); } finally { this.reverting = null; }
  }

  override redo(): StackItem | null {
    this.reverting = { live: this.redoStack, before: this.redoStack.slice() };
    try { return super.redo(); } finally { this.reverting = null; }
  }
}

const captureLocal = (transaction: Y.Transaction) => transaction.local && transaction.meta.get('addToHistory') !== false;

/** Pass the returned manager to yUndoPlugin({ undoManager }); never also add PM history. */
export function createLocalUndoManager(scope: KnowledgeUndoScope, options: {
  origin: HumanOrigin;
  /** e.g. ySyncPluginKey; object identity only, never an origin constructor. */
  bindingOrigins?: readonly object[];
  captureTimeout?: number;
}): Y.UndoManager {
  if (parseKnowledgeOrigin(options.origin)?.kind !== 'human') throw new TypeError('Local undo requires a human client origin');
  const captureTimeout = options.captureTimeout ?? 500;
  if (!Number.isFinite(captureTimeout) || captureTimeout < 0) throw new TypeError('Invalid undo capture interval');
  const bindings = options.bindingOrigins ?? [];
  if (bindings.some((binding) => typeof binding !== 'object' || binding === null)) throw new TypeError('Editor binding origins must be objects');
  return new KnowledgeUndoManager(scope, {
    trackedOrigins: new Set<unknown>([options.origin, ...bindings]),
    captureTimeout, captureTransaction: captureLocal,
  });
}

/** Create before a task writes. Every streamed block joins one task-local undo item. */
export function createTaskUndoManager(scope: KnowledgeUndoScope, origin: AgentOrigin | McpOrigin): Y.UndoManager {
  const source = parseKnowledgeOrigin(origin);
  if (source?.kind !== 'agent' && source?.kind !== 'mcp') throw new TypeError('Task undo requires an Agent or MCP task origin');
  return new KnowledgeUndoManager(scope, {
    trackedOrigins: new Set([origin]), captureTimeout: Number.POSITIVE_INFINITY,
    captureTransaction: captureLocal,
  });
}
