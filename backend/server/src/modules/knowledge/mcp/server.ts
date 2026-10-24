import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Pool } from 'pg';
import { knowledgeAgentTools } from '../ai/tools';
import type { KnowledgeAgentWriteContext } from '../ai/tools';
import { KnowledgeAccessError } from '../access/access-policy';
import type { KnowledgeRequestAuthenticator, KnowledgeRequestContext } from '../access';
import { knowledgeMcpWwwAuthenticate } from './oauth';

export interface KnowledgeMcpDependencies {
  authenticator: KnowledgeRequestAuthenticator;
  pool: Pool;
  /** 可选:协作宿主,写工具经 direct connection 提交建议。 */
  hocuspocus?: KnowledgeAgentWriteContext['hocuspocus'];
  /** 可选:启用后未认证响应按 RFC 9727 指向 OAuth 发现文档。 */
  oauth?: { readonly externalOrigin: string };
}

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  authority: KnowledgeRequestContext;
}

/**
 * K01: Streamable HTTP MCP service over the J02/J03 tool registry. Sessions
 * are knowledgeBase-scoped and PAT-authenticated; one McpServer instance lives
 * per session so client identity (initialize) is available to write-tool
 * attribution, and tearing a session down releases its transport. Every tool
 * call re-runs A03 scope checks and P03 authorization - the MCP surface adds
 * no authority of its own.
 */
export function createKnowledgeMcpRequestHandler(deps: KnowledgeMcpDependencies) {
  const sessions = new Map<string, McpSession>();

  const buildSession = async (authority: KnowledgeRequestContext): Promise<McpSession> => {
    const sessionId = randomUUID();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId, enableJsonResponse: true });
    const server = new McpServer({ name: 'fob-knowledge', version: '1.0.0' }, { capabilities: { logging: {} } });
    const clientName = () => server.server.getClientVersion()?.name;

    for (const tool of knowledgeAgentTools) {
      const shape = (tool.inputSchema as unknown as { shape?: Record<string, never> }).shape ?? {};
      server.registerTool(tool.name, { description: tool.description, inputSchema: shape }, async (input, extra) => {
        const context: KnowledgeAgentWriteContext = {
          pool: deps.pool,
          authority,
          hocuspocus: deps.hocuspocus,
          agent: { taskId: String(extra.requestId ?? randomUUID()), clientName: clientName() },
        };
        return { content: [{ type: 'text', text: JSON.stringify(await tool.execute(input, context)) }] };
      });
    }

    server.server.onerror = () => undefined;
    transport.onclose = () => sessions.delete(sessionId);
    await server.connect(transport);
    const session: McpSession = { transport, server, authority };
    sessions.set(sessionId, session);
    return session;
  };

  return async function handleKnowledgeMcp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const knowledgeBaseId = /\/api\/knowledge\/([a-zA-Z0-9-]+)\/mcp\/?$/.exec(request.url ?? '')?.[1] ?? '';
    try {
      const authenticate = () => deps.authenticator.authenticate(
        new Request(`http://mcp.local${request.url ?? '/'}`, { method: request.method, headers: request.headers as Record<string, string> }),
        knowledgeBaseId,
        ['read'],
      );

      const sessionId = request.headers['mcp-session-id'];
      if (typeof sessionId === 'string' && sessionId) {
        const session = sessions.get(sessionId);
        if (session) {
          // 会话内的后续请求仍逐请求重验令牌;范围/成员失效即拒绝。
          await authenticate();
          await session.transport.handleRequest(request, response);
          return;
        }
      }

      // 新会话(客户端 initialize):认证后建立会话并交给传输层应答。
      const authority = await authenticate();
      const session = await buildSession(authority);
      await session.transport.handleRequest(request, response);
    } catch (error) {
      // RFC 9727:401 指向 RFC 9728 保护资源元数据;其余按访问策略状态码应答。
      const failure = error instanceof KnowledgeAccessError ? error : new KnowledgeAccessError('AUTH_UNAVAILABLE');
      if (!response.headersSent) {
        const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store' };
        if (failure.status === 401) {
          headers['www-authenticate'] = deps.oauth ? knowledgeMcpWwwAuthenticate(deps.oauth.externalOrigin, knowledgeBaseId) : 'Bearer realm="knowledge"';
        }
        response.writeHead(failure.status, headers);
        response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: failure.message }, id: null }));
      } else {
        response.end();
      }
    }
  };
}
