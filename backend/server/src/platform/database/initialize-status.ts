import { getTableConfig } from 'drizzle-orm/pg-core';
import { allApplicationTables, resourceTables } from './schema';
import { resourcePoliciesForTable } from './resources/rls';
import { assertFobApplicationRole } from './initialize-role';
import type { FobSqlConnection } from './initialize-role';

export const fobDatabaseSchemas = ['resources', 'auth', 'catalog'] as const;
const requiredExtensions = ['ltree', 'pg_search', 'vector'];

export interface FobDatabaseStatus {
  state: 'empty' | 'incomplete' | 'ready';
  schemas: string[];
  tables: number;
  expectedTables: number;
  forcedResourceTables: number;
  expectedResourceTables: number;
  extensions: string[];
  issues: string[];
}

// pg_get_expr adds redundant parentheses, text casts, and the subquery's output
// alias. Compare the remaining complete token stream, not a substring match.
function normalizePolicy(value: string): string {
  return value.toLowerCase().replaceAll('"', '').replaceAll('::text', '').replace(/\bas\s+nullif\b/g, '').replace(/[\s()]/g, '');
}

function normalizeType(value: string): string {
  return value.replaceAll('"', '').replace(/\b(?:resources|public)\./g, '').replace(/^varchar\(/, 'character varying(');
}

/** Read-only structural, RLS, extension and runtime-grant verification. */
export async function inspectFobDatabase(admin: FobSqlConnection, application: FobSqlConnection): Promise<FobDatabaseStatus> {
  const role = await assertFobApplicationRole(admin, application);
  const namespaces = await admin.query<{ name: string }>('SELECT nspname AS name FROM pg_namespace WHERE nspname = ANY($1::text[]) ORDER BY nspname', [[...fobDatabaseSchemas]]);
  const extensions = await admin.query<{ name: string }>('SELECT extname AS name FROM pg_extension WHERE extname = ANY($1::text[]) ORDER BY extname', [requiredExtensions]);
  const issues: string[] = [];
  const status: FobDatabaseStatus = {
    state: 'empty', schemas: namespaces.rows.map((row) => row.name), tables: 0, expectedTables: allApplicationTables.length,
    forcedResourceTables: 0, expectedResourceTables: resourceTables.length,
    extensions: extensions.rows.map((row) => row.name), issues,
  };
  if (!status.schemas.length) return status;
  status.state = 'incomplete';
  for (const expected of fobDatabaseSchemas) if (!status.schemas.includes(expected)) issues.push(`Missing schema: ${expected}`);
  for (const expected of requiredExtensions) if (!status.extensions.includes(expected)) issues.push(`Missing extension: ${expected}`);

  const relations = await admin.query<{ schema: string; name: string; enabled: boolean; forced: boolean; owner: string }>(`
    SELECT n.nspname AS schema, c.relname AS name, c.relrowsecurity AS enabled,
      c.relforcerowsecurity AS forced, pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1::text[]) AND c.relkind = 'r'
  `, [[...fobDatabaseSchemas]]);
  status.tables = relations.rows.length;
  const columns = await admin.query<{ schema: string; table: string; name: string; type: string; notNull: boolean; identity: string; defaultValue: string | null }>(`
    SELECT n.nspname AS schema, c.relname AS table, a.attname AS name,
      format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS "notNull", a.attidentity AS identity,
      pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = ANY($1::text[]) AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
  `, [[...fobDatabaseSchemas]]);
  const constraints = await admin.query<{ schema: string; table: string; name: string; validated: boolean }>(`
    SELECT n.nspname AS schema, c.relname AS table, k.conname AS name, k.convalidated AS validated
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1::text[])
  `, [[...fobDatabaseSchemas]]);
  const indexes = await admin.query<{ schema: string; table: string; name: string; method: string; valid: boolean }>(`
    SELECT n.nspname AS schema, c.relname AS table, i.relname AS name, a.amname AS method, x.indisvalid AS valid
    FROM pg_index x JOIN pg_class c ON c.oid = x.indrelid JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_am a ON a.oid = i.relam
    WHERE n.nspname = ANY($1::text[])
  `, [[...fobDatabaseSchemas]]);
  const policies = await admin.query<{ schema: string; table: string; name: string; command: string; permissive: boolean; roles: number[]; using: string; check: string }>(`
    SELECT n.nspname AS schema, c.relname AS table, p.polname AS name, p.polcmd AS command,
      p.polpermissive AS permissive, p.polroles AS roles,
      pg_get_expr(p.polqual, p.polrelid) AS using, pg_get_expr(p.polwithcheck, p.polrelid) AS check
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1::text[])
  `, [[...fobDatabaseSchemas]]);

  const key = (schema: string, name: string) => `${schema}.${name}`;
  const expectedTables = new Set(allApplicationTables.map((table) => { const config = getTableConfig(table); return key(config.schema!, config.name); }));
  for (const relation of relations.rows) if (!expectedTables.has(key(relation.schema, relation.name))) issues.push('Unexpected table in Fob schemas');
  for (const table of allApplicationTables) {
    const config = getTableConfig(table);
    const target = key(config.schema!, config.name);
    const relation = relations.rows.find((row) => key(row.schema, row.name) === target);
    if (!relation) { issues.push(`Missing table: ${target}`); continue; }
    if (relation.owner === role.name) issues.push(`Application role owns table: ${target}`);
    if (config.schema === 'resources') {
      if (relation.enabled && relation.forced) status.forcedResourceTables += 1;
      else issues.push(`RLS not enabled and forced: ${target}`);
      const tablePolicies = policies.rows.filter((row) => key(row.schema, row.table) === target);
      const expectedPolicies = resourcePoliciesForTable(table);
      if (tablePolicies.length !== expectedPolicies.length || expectedPolicies.some((expected) => {
        const policy = tablePolicies.find((item) => item.name === expected.name);
        return !policy || policy.command !== ({ ALL: '*', SELECT: 'r', INSERT: 'a', UPDATE: 'w', DELETE: 'd' }[expected.command]) || !policy.permissive || policy.roles.length !== 1 || policy.roles[0] !== 0
          || normalizePolicy(policy.using ?? '') !== normalizePolicy(expected.using ?? '') || normalizePolicy(policy.check ?? '') !== normalizePolicy(expected.check ?? '');
      })) {
        issues.push(`Resource policy differs from current definition: ${target}`);
      }
    }
    const tableColumns = columns.rows.filter((row) => key(row.schema, row.table) === target);
    if (tableColumns.length !== config.columns.length) issues.push(`Column count differs: ${target}`);
    for (const column of config.columns) {
      const actual = tableColumns.find((item) => item.name === column.name);
      if (!actual || normalizeType(actual.type) !== normalizeType(column.getSQLType()) || actual.notNull !== column.notNull || actual.identity !== (column.generatedIdentity?.type === 'always' ? 'a' : column.generatedIdentity ? 'd' : '')) {
        issues.push(`Column differs: ${target}.${column.name}`);
      }
    }
    const requiredConstraints = [
      ...config.checks.map((item) => item.name), ...config.foreignKeys.map((item) => item.getName()),
      ...config.primaryKeys.map((item) => item.getName()), ...config.uniqueConstraints.map((item) => item.getName()),
      ...config.columns.filter((column) => column.isUnique).map((column) => column.uniqueName),
      ...config.columns.filter((column) => column.primary).map(() => `${config.name}_pkey`),
    ];
    for (const name of requiredConstraints) {
      if (!constraints.rows.some((row) => key(row.schema, row.table) === target && row.name === name && row.validated)) issues.push(`Missing or unvalidated constraint: ${target}.${name}`);
    }
    for (const expected of config.indexes) {
      if (!indexes.rows.some((row) => key(row.schema, row.table) === target && row.name === expected.config.name && row.method === (expected.config.method ?? 'btree') && row.valid)) {
        issues.push(`Missing or invalid index: ${target}.${expected.config.name}`);
      }
    }
  }

  const schemaPrivileges = await admin.query<{ name: string; usage: boolean; create: boolean }>(`
    SELECT nspname AS name, has_schema_privilege($2::name, oid, 'USAGE') AS usage, has_schema_privilege($2::name, oid, 'CREATE') AS create
    FROM pg_namespace WHERE nspname = ANY($1::text[])
  `, [[...fobDatabaseSchemas], role.name]);
  for (const row of schemaPrivileges.rows) if (!row.usage || row.create) issues.push('Application schema grants differ from least privilege');
  const privileges = await admin.query<{ allowed: boolean; elevated: boolean }>(`
    SELECT has_table_privilege($2::name, c.oid, 'SELECT') AND CASE WHEN n.nspname = 'catalog'
      THEN NOT (has_table_privilege($2::name, c.oid, 'INSERT') OR has_table_privilege($2::name, c.oid, 'UPDATE') OR has_table_privilege($2::name, c.oid, 'DELETE'))
      ELSE has_table_privilege($2::name, c.oid, 'INSERT') AND has_table_privilege($2::name, c.oid, 'UPDATE') AND has_table_privilege($2::name, c.oid, 'DELETE') END AS allowed,
      has_table_privilege($2::name, c.oid, 'TRUNCATE') OR has_table_privilege($2::name, c.oid, 'REFERENCES') OR has_table_privilege($2::name, c.oid, 'TRIGGER') AS elevated
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1::text[]) AND c.relkind = 'r'
  `, [[...fobDatabaseSchemas], role.name]);
  if (privileges.rows.some((row) => !row.allowed || row.elevated)) issues.push('Application table grants differ from least privilege');
  const sequences = await admin.query<{ allowed: boolean; elevated: boolean }>(`
    SELECT has_sequence_privilege($2::name, c.oid, 'USAGE') AND has_sequence_privilege($2::name, c.oid, 'SELECT') AS allowed,
      has_sequence_privilege($2::name, c.oid, 'UPDATE') AS elevated
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY($1::text[]) AND c.relkind = 'S'
  `, [[...fobDatabaseSchemas], role.name]);
  if (sequences.rows.some((row) => !row.allowed || row.elevated)) issues.push('Application sequence grants differ from least privilege');
  if (!issues.length) status.state = 'ready';
  return status;
}
