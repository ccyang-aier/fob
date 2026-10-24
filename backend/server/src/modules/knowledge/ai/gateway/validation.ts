import { jsonSchema, modelMessageSchema } from 'ai';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import { entityIdSchema, modelSettingsSchema } from '@fob/shared/knowledge/contracts';
import { ModelGatewayError } from './errors';
import type { CallOptions, TextCall } from './types';

const optionsSchema = z.object({
  context: z.strictObject({ knowledgeBaseId: entityIdSchema, userId: entityIdSchema, taskId: entityIdSchema.optional() }),
  settings: modelSettingsSchema,
  timeoutMs: z.number().int().min(1).max(300_000).default(60_000),
  maxRetries: z.number().int().min(0).max(2).default(1),
});
const utf8Size = (text: string) => new TextEncoder().encode(text).byteLength;
export function validateCall(options: CallOptions) {
  const result = optionsSchema.safeParse(options);
  if (!result.success) throw new ModelGatewayError('invalid_request');
  return result.data;
}
export function validateTextCall(input: TextCall) {
  if (!['fast', 'smart', 'vision'].includes(input.tier) || !Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 200
    || (input.system !== undefined && (typeof input.system !== 'string' || input.system.length > 100_000))
    || (input.maxOutputTokens !== undefined && (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 32_768))
    || (input.temperature !== undefined && (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2))) throw new ModelGatewayError('invalid_request');
  let bytes = utf8Size(input.system ?? '');
  for (const message of input.messages) {
    if (!modelMessageSchema.safeParse(message).success || message.providerOptions) throw new ModelGatewayError('invalid_request');
    if (typeof message.content === 'string') bytes += utf8Size(message.content);
    else for (const part of message.content) {
      if ('providerOptions' in part && part.providerOptions) throw new ModelGatewayError('invalid_request');
      // Nested tool media can otherwise bypass the top-level asset-byte policy.
      // Tool context is text/JSON; authorized vision bytes use a user media part.
      if (part.type === 'tool-result' && part.output.type === 'content' && part.output.value.some((item) => item.type !== 'text')) throw new ModelGatewayError('invalid_request');
      if (part.type === 'image' || part.type === 'file') {
        const data = part.type === 'image' ? part.image : part.data;
        // The asset service grants access before loading bytes; the SDK never fetches arbitrary URLs.
        if (input.tier !== 'vision' || !(data instanceof Uint8Array) || data.byteLength > 8 * 1024 * 1024) throw new ModelGatewayError('invalid_request');
        bytes += data.byteLength;
      } else bytes += utf8Size(JSON.stringify(part));
    }
  }
  const tools: ToolSet = Object.create(null);
  if (input.tools) {
    if (Object.keys(input.tools).length > 64) throw new ModelGatewayError('invalid_request');
    for (const [name, definition] of Object.entries(input.tools)) {
      if (!/^[a-zA-Z][\w-]{0,63}$/.test(name) || Object.keys(definition).some((key) => !['description', 'inputSchema'].includes(key))
        || typeof definition.description !== 'string' || definition.description.length > 8000
        || !z.json().safeParse(definition.inputSchema).success || JSON.stringify(definition.inputSchema).length > 32_768) throw new ModelGatewayError('invalid_request');
      tools[name] = { description: definition.description, inputSchema: jsonSchema(definition.inputSchema) };
      bytes += utf8Size(JSON.stringify(definition));
    }
  }
  if (bytes > (input.tier === 'vision' ? 10 * 1024 * 1024 : 1_000_000)) throw new ModelGatewayError('invalid_request');
  return Object.keys(tools).length ? tools : undefined;
}
export function validateTexts(values: string[], query?: string, topN?: number) {
  if (!Array.isArray(values) || !values.length || values.length > 512 || values.some((value) => typeof value !== 'string' || !value.length || value.length > 100_000)
    || (query !== undefined && (typeof query !== 'string' || !query.length || query.length > 32_768))
    || (topN !== undefined && (!Number.isInteger(topN) || topN < 1 || topN > values.length))) throw new ModelGatewayError('invalid_request');
  if (values.reduce((sum, value) => sum + utf8Size(value), utf8Size(query ?? '')) > 1_000_000) throw new ModelGatewayError('invalid_request');
}
