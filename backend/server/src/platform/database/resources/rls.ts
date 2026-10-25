import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { PoolClient } from 'pg';
import { resourceTables } from './schema';

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const currentKnowledgeBase = `(SELECT NULLIF(current_setting('app.knowledge_base_id', true), '')::uuid)`;
const readKnowledgeBase = `(SELECT NULLIF(current_setting('app.read_knowledge_base_id', true), '')::uuid)`;
export const knowledgeBasePredicate = `"knowledge_base_id" = ${currentKnowledgeBase}`;

const verifiedIdentityUser = `(SELECT s.user_id FROM auth.session s
  JOIN auth."user" u ON u.id = s.user_id
  WHERE s.id = NULLIF(current_setting('app.auth_session_id', true), '')::uuid
    AND s.expires_at > clock_timestamp() AND u.email_verified IS TRUE)`;

export interface ResourceRlsPolicy {
  name: 'knowledge_base_scope' | 'own_identity' | 'reference_read' | 'backlink_target' | 'account_read' | 'account_award';
  command: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  using?: string;
  check?: string;
}

/** Knowledge resources use a library scope; account assets use verified identity only. */
export function resourcePoliciesForTable(table: PgTable): ResourceRlsPolicy[] {
  const config = getTableConfig(table);
  if (config.name === 'coffee_ledger') return [
    { name: 'account_read', command: 'SELECT', using: `"user_id" = ${verifiedIdentityUser}` },
    { name: 'account_award', command: 'INSERT', check: `"user_id" = ${verifiedIdentityUser} AND "day" = (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date` },
  ];
  const predicate = config.name === 'knowledge_base' ? `"id" = ${currentKnowledgeBase}` : knowledgeBasePredicate;
  const readPredicate = `${config.name === 'knowledge_base' ? '"id"' : '"knowledge_base_id"'} = ${readKnowledgeBase}`;
  const policies: ResourceRlsPolicy[] = [{ name: 'knowledge_base_scope', command: 'ALL', using: predicate, check: predicate }];
  // Cross-library reference resolution reads page metadata and its live ACL;
  // it cannot read document bodies, assets, credentials, or grant any writes.
  if (['page', 'page_effective_acl', 'knowledge_base_member', 'group_member'].includes(config.name)) {
    policies.push({ name: 'reference_read', command: 'SELECT', using: readPredicate });
  }
  if (config.name === 'backlink') policies.push({ name: 'backlink_target', command: 'SELECT', using: `"dst_knowledge_base_id" = ${currentKnowledgeBase}` });
  if (config.name === 'knowledge_base_member') policies.push({ name: 'own_identity', command: 'SELECT', using: `"user_id" = ${verifiedIdentityUser}` });
  if (config.name === 'knowledge_base') policies.push({
    name: 'own_identity', command: 'SELECT',
    using: `EXISTS (SELECT 1 FROM resources.knowledge_base_member m WHERE m.knowledge_base_id = knowledge_base.id AND m.user_id = ${verifiedIdentityUser})`,
  });
  return policies;
}

/** DDL identifiers come only from the checked-in Drizzle table definitions. */
export function resourceRlsSql(tables: readonly PgTable[] = resourceTables): string {
  return tables.map((table) => {
    const config = getTableConfig(table);
    const name = `${identifier(config.schema!)}.${identifier(config.name)}`;
    return [
      `ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE ${name} FORCE ROW LEVEL SECURITY;`,
      ...resourcePoliciesForTable(table).map((policy) => `CREATE POLICY ${identifier(policy.name)} ON ${name} FOR ${policy.command} TO PUBLIC${policy.using ? ` USING (${policy.using})` : ''}${policy.check ? ` WITH CHECK (${policy.check})` : ''};`),
    ].join('\n');
  }).join('\n');
}

/** Install once inside the same admin transaction that creates current.sql. */
export async function installResourceRls(client: Pick<PoolClient, 'query'>): Promise<void> {
  await client.query(resourceRlsSql());
}
