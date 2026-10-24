import type { FobServiceConfig, RuntimeRole } from './config';

export interface RunningRole {
  close(): Promise<void>;
  health(): Promise<{ status: 'ready' | 'degraded'; detail?: string }>;
}
export type RoleFactory = (context: { config: FobServiceConfig; signal: AbortSignal }) => Promise<RunningRole>;

/** Role composition is infrastructure only; each role owns and releases its resources. */
export async function startFobRoles(config: FobServiceConfig, factories: Partial<Record<RuntimeRole, RoleFactory>>) {
  for (const role of config.roles) if (!factories[role]) throw new Error(`Fob service role is not registered: ${role}`);
  const controller = new AbortController();
  const running = new Map<RuntimeRole, RunningRole>();
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (!closing) closing = (async () => {
      controller.abort();
      const errors: unknown[] = [];
      for (const instance of [...running.values()].reverse()) {
        try { await instance.close(); } catch (error) { errors.push(error); }
      }
      running.clear();
      if (errors.length) throw new AggregateError(errors, 'Fob service role shutdown failed');
    })();
    return closing;
  };
  try {
    for (const role of config.roles) running.set(role, await factories[role]!({ config, signal: controller.signal }));
  } catch (error) {
    try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Fob service startup and cleanup failed'); }
    throw error;
  }
  return {
    close,
    async health() {
      if (controller.signal.aborted) return { status: 'stopped' as const, roles: {} };
      const entries = await Promise.all([...running].map(async ([role, instance]) => {
        try { return [role, await instance.health()] as const; }
        catch { return [role, { status: 'degraded' as const, detail: 'Health probe failed' }] as const; }
      }));
      return { status: entries.every(([, result]) => result.status === 'ready') ? 'ready' as const : 'degraded' as const, roles: Object.fromEntries(entries) };
    },
  };
}
