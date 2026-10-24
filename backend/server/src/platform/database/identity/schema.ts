import { sql } from 'drizzle-orm';
import { boolean, check, index, text, unique, uuid, varchar, pgSchema, timestamp } from 'drizzle-orm/pg-core';
export const identity = pgSchema('auth');
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Better Auth's core fields; configure its id generator to UUIDs. */
export const authUser = identity.table('user', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  check('user_name_not_empty', sql`length(btrim(${table.name})) > 0`),
]);

export const authSession = identity.table('session', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: instant('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  index('session_user_idx').on(table.userId),
  index('session_expiry_idx').on(table.expiresAt),
]);

export const authAccount = identity.table('account', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: instant('access_token_expires_at'),
  refreshTokenExpiresAt: instant('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('account_provider_account_unique').on(table.providerId, table.accountId),
  index('account_user_idx').on(table.userId),
]);

export const authVerification = identity.table('verification', {
  id: uuid('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: instant('expires_at').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  index('verification_identifier_idx').on(table.identifier),
  index('verification_expiry_idx').on(table.expiresAt),
]);
