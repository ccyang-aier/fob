export function assistantErrorKey(code: string) {
  if (code === 'configuration' || code === 'credential_unavailable') return 'configuration';
  if (code === 'provider_auth') return 'authFailed';
  if (code === 'rate_limited' || code === 'too_many_requests') return 'rateLimited';
  if (code === 'timeout') return 'timeout';
  if (code === 'access_changed' || code === 'TARGET_NOT_ACCESSIBLE' || code === 'FORBIDDEN' || code === 'UNAUTHENTICATED') return 'accessChanged';
  if (code === 'conversation_busy') return 'busy';
  if (code === 'interrupted') return 'disconnected';
  return 'failed';
}
