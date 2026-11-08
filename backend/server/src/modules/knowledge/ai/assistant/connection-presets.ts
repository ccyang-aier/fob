/** Kept for migrating existing personal bindings; new connections are generic. */
export const assistantProviders = {
  'zhipu-coding': { protocol: 'openai-compatible' as const, endpoints: ['https://open.bigmodel.cn/api/coding/paas/v4'], tiers: ['fast', 'smart'] as const },
  'zhipu-general': { protocol: 'openai-compatible' as const, endpoints: ['https://open.bigmodel.cn/api/paas/v4'], tiers: ['fast', 'smart'] as const },
};
export const connectionProviderId = (id: string) => `fob-connection-${id}`;
export const connectionIdFromProvider = (provider: string) => /^fob-connection-([a-f0-9-]{36})$/.exec(provider)?.[1];
