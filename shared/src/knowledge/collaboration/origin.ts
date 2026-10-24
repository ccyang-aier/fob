import { nanoid } from 'nanoid';
import { isValidBlockId } from '../schema/block-id';

export type HumanOrigin = `human:${string}`;
export type AgentOrigin = `agent:${string}`;
export type McpOrigin = `mcp:${string}:${string}`;
export type RestoreOrigin = `restore:${string}`;
export type KnowledgeOrigin = HumanOrigin | AgentOrigin | McpOrigin | RestoreOrigin;
export type KnowledgeSource =
  | { kind: 'human'; clientId: string }
  | { kind: 'agent'; taskId: string }
  | { kind: 'mcp'; clientName: string; taskId: string }
  | { kind: 'restore'; checkpointId: string };

function checkedId(value: string): string {
  if (!isValidBlockId(value)) throw new TypeError('A collaboration origin requires a valid identifier');
  return value;
}

/** A client session, not a user: two windows must have independent undo histories. */
export function humanOrigin(clientId = nanoid()): HumanOrigin { return `human:${checkedId(clientId)}`; }
export function agentOrigin(taskId: string): AgentOrigin { return `agent:${checkedId(taskId)}`; }
export function restoreOrigin(checkpointId: string): RestoreOrigin { return `restore:${checkedId(checkpointId)}`; }
export function mcpOrigin(clientName: string, taskId: string): McpOrigin {
  if (!clientName.trim() || clientName.length > 120 || /[\u0000-\u001f\u007f]/.test(clientName)) {
    throw new TypeError('An MCP origin requires a client name');
  }
  // Client names can contain colons and non-ASCII characters. The task suffix
  // distinguishes concurrent calls from the same client; display uses clientName.
  return `mcp:${encodeURIComponent(clientName)}:${checkedId(taskId)}`;
}

/** Origins describe local transactions; they are neither authentication nor persisted authorship. */
export function parseKnowledgeOrigin(value: unknown): KnowledgeSource | null {
  if (typeof value !== 'string') return null;
  const [kind, id, taskId, extra] = value.split(':');
  if (extra !== undefined) return null;
  if (kind === 'mcp') {
    try {
      const clientName = decodeURIComponent(id);
      return mcpOrigin(clientName, taskId) === value ? { kind, clientName, taskId } : null;
    } catch { return null; }
  }
  if (taskId !== undefined || !isValidBlockId(id)) return null;
  if (kind === 'human') return { kind, clientId: id };
  if (kind === 'agent') return { kind, taskId: id };
  if (kind === 'restore') return { kind, checkpointId: id };
  return null;
}
