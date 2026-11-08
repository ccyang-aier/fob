import type * as Y from 'yjs';
import { collectSuggestions } from '@fob/shared/knowledge/schema/suggestions';
import { agentOrigin } from '@fob/shared/knowledge/collaboration';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { yStateToProseMirrorDoc } from '../../import-export/y-encoding';
import { KnowledgeAgentToolError } from '../tools/errors';
import * as Yjs from 'yjs';

export interface InsertionReceipt { turnId: string; userId: string; retainedTurnIds: readonly string[] }
const namespace = 'fob:assistant:insertion-receipts';
const capacity = 256;

/** Called inside the same Yjs transaction as the body mutation. */
export function withInsertionReceipt(document: Y.Doc, receipt: InsertionReceipt | undefined, insert: () => string): string {
  if (!receipt) return insert();
  const records = document.getMap<string>(namespace), prefix = `${receipt.userId}:`, key = `${prefix}${receipt.turnId}`;
  const retained = new Set(receipt.retainedTurnIds.map(turnId => `${prefix}${turnId}`));
  for (const prior of records.keys()) if (prior.startsWith(prefix) && prior !== key && !retained.has(prior)) records.delete(prior);
  const previous = records.get(key);
  if (previous) return previous;
  // Recover an insertion written by an earlier build, before receipts existed.
  const body = yStateToProseMirrorDoc(Yjs.encodeStateAsUpdate(document), knowledgeSchema);
  const pending = body && collectSuggestions(body).find(suggestion => suggestion.author === agentOrigin(receipt.turnId));
  if (records.size >= capacity) throw new KnowledgeAgentToolError('WRITE_RECEIPT_CAPACITY', 'insert');
  const suggestionId = pending ? pending.suggestionId : insert();
  records.set(key, suggestionId);
  return suggestionId;
}
