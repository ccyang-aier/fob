import { authAccount, authSession, authUser, authVerification } from './schema';

/** Global identity storage; resource modules reference these users. */
export const identityTables = [authUser, authSession, authAccount, authVerification];
