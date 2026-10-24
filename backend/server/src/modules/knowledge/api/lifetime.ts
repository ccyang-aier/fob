import { TRPCError } from '@trpc/server';

/** Abort reasons from transports are untrusted; only our fixed codes cross the boundary. */
export function createRequestLifetime(request: AbortSignal, shutdown?: AbortSignal) {
  const controller = new AbortController();
  const cancelled = () => controller.abort(new TRPCError({ code: 'CLIENT_CLOSED_REQUEST' }));
  const stopping = () => controller.abort(new TRPCError({ code: 'SERVICE_UNAVAILABLE' }));
  if (shutdown?.aborted) stopping();
  else if (request.aborted) cancelled();
  else {
    request.addEventListener('abort', cancelled, { once: true });
    shutdown?.addEventListener('abort', stopping, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      request.removeEventListener('abort', cancelled);
      shutdown?.removeEventListener('abort', stopping);
    },
  };
}

export function assertRequestActive(signal: AbortSignal) {
  if (!signal.aborted) return;
  const code = signal.reason instanceof TRPCError && signal.reason.code === 'SERVICE_UNAVAILABLE'
    ? 'SERVICE_UNAVAILABLE' : 'CLIENT_CLOSED_REQUEST';
  throw new TRPCError({ code });
}
