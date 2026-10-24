import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import type { Hocuspocus } from '@hocuspocus/server';
import type { AwarenessState } from '@fob/shared/knowledge/contracts';
import { parsePageDocument } from '@fob/shared/knowledge/collaboration';

/** Everything callers may vary per publish; identity stays fixed per session. */
export interface AgentAwarenessIdentity {
  userId: string;
  taskId: string;
  name: string;
  /** Hex color shown to peers, e.g. '#3b82f6'. */
  color: string;
}

export interface AgentAwarenessPublish {
  cursor?: AwarenessState['cursor'];
  selection?: AwarenessState['selection'];
  isEditing?: boolean;
}

export interface AgentAwarenessSession {
  /** Broadcast a fresh agent state; omitted fields reset to defaults. */
  publish(state: AgentAwarenessPublish): void;
  /** Remove the agent state and release the direct connection. Idempotent. */
  stop(): Promise<void>;
}

const hexColor = /^#[0-9a-fA-F]{6}$/;

/**
 * Server-side Agent presence (B09): a direct connection publishes cursor /
 * selection / editing states into the page's shared awareness under a stable
 * synthetic client, so every protocol client sees the agent exactly like a
 * human peer. Task end and aborts always clear the state before the
 * connection is released; nothing survives a crashed session beyond the
 * awareness timeout the protocol already defines.
 */
export async function createAgentAwarenessSession(hocuspocus: Hocuspocus, options: { documentName: string; identity: AgentAwarenessIdentity; signal?: AbortSignal }): Promise<AgentAwarenessSession> {
  const scope = parsePageDocument(options.documentName);
  if (!scope) throw new Error('Agent awareness requires a strict page document name.');
  const { identity } = options;
  if (!hexColor.test(identity.color)) throw new Error('Agent awareness color must be a #rrggbb value.');

  const connection = await hocuspocus.openDirectConnection(options.documentName, {
    pageId: scope.pageId,
    actor: { kind: 'agent', userId: identity.userId, taskId: identity.taskId },
  });
  const scratchDoc = new Y.Doc();
  const scratch = new Awareness(scratchDoc);
  let stopped = false;

  const apply = () => {
    const document = connection.document;
    if (!document) return;
    applyAwarenessUpdate(document.awareness, encodeAwarenessUpdate(scratch, [scratchDoc.clientID]), 'agent');
  };

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    options.signal?.removeEventListener('abort', stop);
    try {
      removeAwarenessStates(scratch, [scratchDoc.clientID], 'agent');
      apply();
    } finally {
      scratch.destroy();
      scratchDoc.destroy();
      await connection.disconnect();
    }
  };
  options.signal?.addEventListener('abort', () => void stop());

  return {
    publish(state) {
      if (stopped) throw new Error('Agent awareness session already stopped.');
      scratch.setLocalState({
        user: { id: identity.userId, name: identity.name },
        color: identity.color,
        kind: 'agent',
        cursor: state.cursor ?? null,
        selection: state.selection ?? null,
        isEditing: state.isEditing ?? true,
        taskId: identity.taskId,
      } satisfies AwarenessState);
      apply();
    },
    stop,
  };
}
