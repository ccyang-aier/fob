import { APICallError, InvalidResponseDataError, JSONParseError, RetryError, TypeValidationError } from 'ai';

export type GatewayErrorCode = 'invalid_request' | 'configuration' | 'credential_unavailable' | 'unsupported_capability'
  | 'endpoint_denied' | 'cancelled' | 'timeout' | 'provider_auth' | 'rate_limited' | 'provider_unavailable'
  | 'invalid_response' | 'response_too_large' | 'observation_failed';

/** No SDK cause, response body, URL, prompt or key is exposed on this boundary. */
export class ModelGatewayError extends Error {
  constructor(readonly code: GatewayErrorCode, readonly retryable = false) {
    super(`Model call failed: ${code}`);
    this.name = 'ModelGatewayError';
  }
}
export function modelGatewayError(error: unknown, signal?: AbortSignal, timedOut = false): ModelGatewayError {
  if (signal?.aborted) return new ModelGatewayError(timedOut ? 'timeout' : 'cancelled', timedOut);
  if (error instanceof ModelGatewayError) return error;
  if (RetryError.isInstance(error)) return modelGatewayError(error.lastError);
  if (InvalidResponseDataError.isInstance(error) || JSONParseError.isInstance(error) || TypeValidationError.isInstance(error)) return new ModelGatewayError('invalid_response');
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) return new ModelGatewayError('provider_auth');
    if (error.statusCode === 429) return new ModelGatewayError('rate_limited', true);
    return new ModelGatewayError('provider_unavailable', error.isRetryable);
  }
  return new ModelGatewayError('provider_unavailable', true);
}
