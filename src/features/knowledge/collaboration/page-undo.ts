/**
 * Page-level undo coordination (B08, design §5.4/§9.3).
 *
 * One controller per open page, attached to the very Y.Doc the page
 * session (B04) owns. Everything here is local-stack machinery, so it
 * behaves identically online, mid-sync and fully offline:
 *
 * - The human stack tracks only this connection's human origin (plus
 *   editor binding origins). Peers' and agents' updates never enter it —
 *   neither remote ones (the provider applies those, and origins do not
 *   cross the wire) nor local transactions under a foreign origin — so
 *   "undo" can never revert somebody else's or an AI's writing.
 * - Each AI/MCP task origin aggregates into undo unit(s) spanning all of
 *   the task's blocks and transactions; `task(origin).undo()` reverts the
 *   whole AI task in one pass. Neither stack disturbs the other, redo
 *   stacks included.
 * - Leaving the page destroys the Y.Doc (B04); the controller reacts to
 *   that by clearing every stack and listener, and `destroy()` does the
 *   same on demand.
 *
 * A task unit only covers writes that are local to this connection's
 * document (client-driven agent writes, applied suggestions). Tasks the
 * backend writes over its own connection are remote updates here and are
 * undone through their server-side path, not from this module.
 */
import {
  createLocalUndoManager,
  createTaskUndoManager,
  humanOrigin,
} from '@fob/shared/knowledge/collaboration';
import type {
  AgentOrigin,
  HumanOrigin,
  KnowledgeUndoScope,
  McpOrigin,
} from '@fob/shared/knowledge/collaboration';
import type * as Y from 'yjs';

/** An AI or MCP task origin; each one owns an isolated undo unit. */
export type TaskUndoOrigin = AgentOrigin | McpOrigin;

/** The aggregated undo unit of one AI/MCP task origin. */
export interface AgentTaskUndo {
  readonly origin: TaskUndoOrigin;
  /**
   * Closes the current unit once the task finished streaming; a later
   * write with the same origin starts a fresh unit (still this handle's).
   */
  end(): void;
  /** Reverts every captured write of this task in one pass; returns whether anything reverted. */
  undo(): boolean;
  /** Restores a task removed by `undo()`; returns whether anything was restored. */
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
}

export interface PageUndoOptions {
  /** The page session's live Y.Doc (B04 `connectPageDocument().document`). */
  document: Y.Doc;
  /** What the stacks cover; defaults to the whole page document. */
  scope?: KnowledgeUndoScope;
  /** Stable connection identity; defaults to a fresh per-session identity. */
  clientId?: string;
  /** Human capture window in milliseconds (kernel default 500). */
  captureTimeoutMs?: number;
  /** Editor binding origins (e.g. ySyncPluginKey) that also count as this human. */
  bindingOrigins?: readonly object[];
}

export interface PageUndo {
  /** Attach to every local editor write of this connection. */
  readonly origin: HumanOrigin;
  /** The human stack; also the `yUndoPlugin({ undoManager })` candidate. */
  readonly local: Y.UndoManager;
  /**
   * The undo unit of one AI/MCP task origin, created on first use — call
   * before the task's first write so it captures the whole task.
   */
  task(origin: TaskUndoOrigin): AgentTaskUndo;
  /** Task origins with a live unit, for "undo AI task" entries. */
  readonly taskOrigins: readonly TaskUndoOrigin[];
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Clears the human and all task stacks and detaches every listener; idempotent. */
  destroy(): void;
}

export function createPageUndo(options: PageUndoOptions): PageUndo {
  const document = options.document;
  const scope = options.scope ?? document;
  const origin = humanOrigin(options.clientId);
  const local = createLocalUndoManager(scope, {
    origin,
    captureTimeout: options.captureTimeoutMs,
    bindingOrigins: options.bindingOrigins,
  });
  const tasks = new Map<TaskUndoOrigin, Y.UndoManager>();
  let destroyed = false;

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    document.off('destroy', destroy);
    for (const manager of tasks.values()) {
      manager.clear();
      manager.destroy();
    }
    tasks.clear();
    local.clear();
    local.destroy();
  };
  // Leaving the page destroys the Y.Doc; the stacks must not survive it.
  document.on('destroy', destroy);

  return {
    origin,
    local,
    task: (taskOrigin) => {
      if (destroyed) throw new Error('Page undo was destroyed with its page session.');
      const existing = tasks.get(taskOrigin);
      const manager = existing ?? createTaskUndoManager(scope, taskOrigin);
      if (!existing) tasks.set(taskOrigin, manager);
      return {
        origin: taskOrigin,
        end: () => manager.stopCapturing(),
        // One task can span several units (an `end()` boundary, late
        // stragglers); the whole origin reverts or restores as one entry.
        undo: () => {
          let applied = false;
          while (manager.undo() !== null) applied = true;
          return applied;
        },
        redo: () => {
          let applied = false;
          while (manager.redo() !== null) applied = true;
          return applied;
        },
        canUndo: () => manager.canUndo(),
        canRedo: () => manager.canRedo(),
      };
    },
    get taskOrigins() {
      return [...tasks.keys()];
    },
    undo: () => local.undo() !== null,
    redo: () => local.redo() !== null,
    canUndo: () => local.canUndo(),
    canRedo: () => local.canRedo(),
    destroy,
  };
}
