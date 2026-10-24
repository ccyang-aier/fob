import { pgSchema } from 'drizzle-orm/pg-core';

/** Business resources share this namespace; each domain owns its authorization policy. */
export const resourcesNamespace = pgSchema('resources');
