import { HocuspocusProvider } from '@hocuspocus/provider';
import type { AuthorizedScope } from '@hocuspocus/provider';
import { WebSocket as NodeWebSocket } from 'ws';
import * as Y from 'yjs';

/** Official protocol client against the real Bun-sidecar listener assembly. */
class HeaderWebSocket extends NodeWebSocket {
  constructor(url: string, protocols?: string[]) {
    super(url, protocols, { headers: HeaderWebSocket.headers, maxPayload: 8 * 1024 * 1024 });
  }
  static headers: Record<string, string> = {};
}

export interface CollaborationClient {
  provider: HocuspocusProvider;
  document: Y.Doc;
  scope(): AuthorizedScope | undefined;
  failure(): string | undefined;
  synced(): boolean;
  destroy(): Promise<void>;
}

export function connectCollaborationClient(options: { port: number; origin: string; name: string; authorization?: string }): CollaborationClient {
  const headers: Record<string, string> = { origin: options.origin };
  if (options.authorization?.startsWith('Bearer ')) headers.authorization = options.authorization;
  else if (options.authorization) headers.cookie = options.authorization;
  HeaderWebSocket.headers = headers;
  const document = new Y.Doc();
  const state = { scope: undefined as AuthorizedScope | undefined, failure: undefined as string | undefined, synced: false };
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${options.port}`,
    name: options.name,
    document,
    WebSocketPolyfill: HeaderWebSocket,
    maxAttempts: 1,
    delay: 0,
    minDelay: 0,
    jitter: false,
    onAuthenticated: ({ scope }: { scope: AuthorizedScope }) => { state.scope = scope; },
    onAuthenticationFailed: ({ reason }: { reason: string }) => { state.failure = reason; },
    onSynced: ({ state: value }: { state: boolean }) => { state.synced = value; },
  } as never);
  return {
    provider, document,
    scope: () => state.scope,
    failure: () => state.failure,
    synced: () => state.synced,
    async destroy() {
      provider.destroy();
      await new Promise((resolve) => setTimeout(resolve, 30));
    },
  };
}
