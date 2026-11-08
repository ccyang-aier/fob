const STORAGE_KEY = 'fob.companion.conversations.v1';
const LIMIT = 10;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Pointer = { userId: string; knowledgeBaseId: string; conversationId: string };
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Browser storage contains only bounded opaque IDs, never conversation content. */
function read(storage: StoragePort | undefined): Pointer[] {
  if (!storage) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('pointers' in value) || !Array.isArray(value.pointers)) return [];
    return value.pointers.filter((item): item is Pointer => Boolean(item && typeof item === 'object' && ['userId', 'knowledgeBaseId', 'conversationId'].every(key => typeof item[key] === 'string' && uuid.test(item[key])))).slice(-LIMIT).map(({ userId, knowledgeBaseId, conversationId }) => ({ userId, knowledgeBaseId, conversationId }));
  } catch { return []; }
}

function write(storage: StoragePort | undefined, pointers: Pointer[]) {
  if (!storage) return;
  try {
    if (pointers.length) storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, pointers: pointers.slice(-LIMIT) }));
    else storage.removeItem(STORAGE_KEY);
  } catch { /* The conversation remains usable when storage is unavailable. */ }
}

export function readConversationPointer(storage: StoragePort | undefined, userId: string, knowledgeBaseId: string): string | null {
  return read(storage).findLast(item => item.userId === userId && item.knowledgeBaseId === knowledgeBaseId)?.conversationId ?? null;
}

export function saveConversationPointer(storage: StoragePort | undefined, pointer: Pointer) {
  if (![pointer.userId, pointer.knowledgeBaseId, pointer.conversationId].every(value => uuid.test(value))) return;
  write(storage, [...read(storage).filter(item => item.userId !== pointer.userId || item.knowledgeBaseId !== pointer.knowledgeBaseId), pointer]);
}

export function clearConversationPointer(storage: StoragePort | undefined, userId: string, knowledgeBaseId: string, conversationId?: string) {
  write(storage, read(storage).filter(item => item.userId !== userId || item.knowledgeBaseId !== knowledgeBaseId || conversationId !== undefined && item.conversationId !== conversationId));
}

export const companionPointerStorageKey = STORAGE_KEY;
