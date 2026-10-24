import type { z } from 'zod';

export type ResourceRequestErrorCode = 'INVALID_INPUT' | 'UNAUTHENTICATED' | 'KNOWLEDGE_BASE_NOT_FOUND' | 'PROJECT_NOT_FOUND' | 'PROJECT_ACCOUNT_NOT_FOUND' | 'PROJECT_MEMBER_EXISTS' | 'PROJECT_MEMBER_NOT_FOUND' | 'FORBIDDEN' | 'MEMBER_NOT_FOUND' | 'GROUP_NOT_FOUND' | 'TEAMSPACE_NOT_FOUND' | 'TEAMSPACE_NOT_EMPTY' | 'LAST_OWNER' | 'CONFLICT' | 'INVITATION_INVALID' | 'TASK_BOARD_NOT_FOUND' | 'TASK_NOT_FOUND' | 'TASK_COLUMN_NOT_FOUND' | 'TASK_COLUMN_NOT_EMPTY' | 'TASK_VIEW_NOT_FOUND';

export class ResourceRequestError extends Error {
  constructor(readonly code: ResourceRequestErrorCode, message: string, readonly status: 400 | 401 | 403 | 404 | 409) {
    super(message);
    this.name = 'ResourceRequestError';
  }
}

export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ResourceRequestError('INVALID_INPUT', 'Invalid organization request.', 400);
  return parsed.data;
}

export function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return 'cause' in error ? postgresCode(error.cause) : undefined;
}

export function resourceFailure(error: unknown): ResourceRequestError | undefined {
  if (error instanceof ResourceRequestError) return error;
  if (postgresCode(error) === '23505') return new ResourceRequestError('CONFLICT', 'This organization record already exists.', 409);
  return undefined;
}
