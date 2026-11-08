import type { AssistantConnectionModel, AssistantConnectionProtocol } from '@fob/shared/knowledge/contracts';
import { ModelGatewayError } from '../gateway';
import type { GatewayFetch } from '../gateway';
import { abortable } from '../abort';

async function boundedJson(response: Response, signal: AbortSignal, charge: (bytes: number) => void): Promise<Record<string, unknown>> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new ModelGatewayError(response.status === 401 || response.status === 403 ? 'provider_auth' : response.status === 429 ? 'rate_limited' : 'provider_unavailable', response.status === 429 || response.status >= 500);
  }
  if (!response.body || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) {
    await response.body?.cancel();
    throw new ModelGatewayError('response_too_large');
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      charge(chunk.value.byteLength); chunks.push(chunk.value);
    }
  } finally { void reader.cancel().catch(() => {}); }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new ModelGatewayError('invalid_response'); }
}

/** Protocol-aware, bounded model listing. Never trusts a provider's next URL. */
export async function discoverConnectionModels(input: {
  baseUrl: string; protocol: AssistantConnectionProtocol; apiKey?: string; fetch: GatewayFetch; signal: AbortSignal;
}) {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]);
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (input.protocol === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
      if (input.apiKey) headers['x-api-key'] = input.apiKey;
    } else if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
    const models: AssistantConnectionModel[] = [], seen = new Set<string>();
    let truncated = false, totalBytes = 0, after: string | null = null;
    const charge = (bytes: number) => { totalBytes += bytes; if (totalBytes > 2 * 1024 * 1024) throw new ModelGatewayError('response_too_large'); };
    for (let page = 0; page < 3; page++) {
      const query = input.protocol === 'anthropic' ? `?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ''}` : '';
      const response = await abortable(input.fetch(`${input.baseUrl}/models${query}`, { headers, signal, redirect: 'error' }), signal);
      const payload = await boundedJson(response, signal, charge);
      if (!Array.isArray(payload.data)) throw new ModelGatewayError('invalid_response');
      truncated = payload.data.length > 300 || payload.has_more === true;
      for (const candidate of payload.data) {
        if (!candidate || typeof candidate !== 'object' || !('id' in candidate) || typeof candidate.id !== 'string') continue;
        const id = candidate.id.trim();
        if (!id || id.length > 200 || seen.has(id)) continue;
        if (models.length >= 300) { truncated = true; break; }
        const name = 'display_name' in candidate && typeof candidate.display_name === 'string' ? candidate.display_name : 'name' in candidate && typeof candidate.name === 'string' ? candidate.name : '';
        seen.add(id); models.push({ id, name: name.trim().slice(0, 200) });
      }
      if (input.protocol !== 'anthropic' || payload.has_more !== true) break;
      const cursor = typeof payload.last_id === 'string' ? payload.last_id : null;
      if (models.length >= 300 || !cursor || cursor.length > 200 || after === cursor) { truncated = true; break; }
      after = cursor;
    }
    return { models, truncated };
  } catch (error) {
    if (signal.aborted) throw new ModelGatewayError(input.signal.aborted ? 'cancelled' : 'timeout');
    if (error instanceof ModelGatewayError) throw error;
    throw new ModelGatewayError('provider_unavailable', true);
  }
}
