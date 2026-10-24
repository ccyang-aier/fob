export type DatabaseErrorCode =
  | 'INVALID_DATABASE_INPUT'
  | 'DATABASE_NOT_FOUND'
  | 'ROW_NOT_FOUND'
  | 'INVALID_DATABASE_COLUMNS'
  | 'INVALID_ROW_PROPERTIES'
  | 'INVALID_DATABASE_QUERY';

/** 内部服务错误:HTTP 鉴权/授权与 actor 上下文属于 P03。 */
export class FobDatabaseError extends Error {
  constructor(readonly code: DatabaseErrorCode) {
    super(`Knowledge database-page operation failed: ${code}`);
    this.name = 'FobDatabaseError';
  }
}
