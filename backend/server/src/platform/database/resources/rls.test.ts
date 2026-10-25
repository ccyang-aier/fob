import { describe, expect, test } from 'bun:test';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { resourceTables, knowledgeBase, member, coffeeLedger } from './schema';
import { resourceRlsSql, resourcePoliciesForTable } from './rls';

describe('resource RLS installation definition', () => {
  test('enables and forces domain-specific policies on every business table', () => {
    const ddl = resourceRlsSql();
    for (const table of resourceTables) {
      const { schema, name } = getTableConfig(table);
      const target = `"${schema}"."${name}"`;
      expect(ddl).toContain(`ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY;`);
      expect(ddl).toContain(`ALTER TABLE ${target} FORCE ROW LEVEL SECURITY;`);
      for (const policy of resourcePoliciesForTable(table)) expect(ddl).toContain(`CREATE POLICY "${policy.name}" ON ${target} FOR ${policy.command} TO PUBLIC`);
    }
    expect(ddl).toContain("NULLIF(current_setting('app.knowledge_base_id', true), '')::uuid");
    expect(ddl).toContain("current_setting('app.auth_session_id', true)");
    expect(ddl).not.toContain('ALTER TABLE "auth"');
  });

  test('knowledge resources are library scoped; account assets have only verified-account read and award policies', () => {
    for (const table of resourceTables.filter(table => table !== coffeeLedger)) expect(resourcePoliciesForTable(table).some((policy) => policy.name === 'knowledge_base_scope')).toBe(true);
    const account = resourcePoliciesForTable(coffeeLedger);
    expect(account.map(policy => policy.command)).toEqual(['SELECT', 'INSERT']);
    expect(account[0].using).toContain('app.auth_session_id');
    expect(account[1].check).toContain("AT TIME ZONE 'Asia/Shanghai'");
    expect(account.some(policy => policy.name === 'knowledge_base_scope')).toBe(false);
    const root = resourcePoliciesForTable(knowledgeBase).find((policy) => policy.name === 'knowledge_base_scope')!;
    expect(root.using).toMatch(/^"id" =/);
  });

  test('catalog discovery uses verified identity and direct knowledge-base membership only', () => {
    const root = resourcePoliciesForTable(knowledgeBase).find((policy) => policy.name === 'own_identity')!;
    const membership = resourcePoliciesForTable(member).find((policy) => policy.name === 'own_identity')!;
    expect(root.command).toBe('SELECT');
    expect(root.using).toContain('resources.knowledge_base_member');
    expect(root.using).toContain('auth.session');
    expect(membership.using).toContain('"user_id" =');
    expect(resourceRlsSql()).not.toContain('project');
    expect(root.using).toContain("app.auth_session_id");
  });
});
