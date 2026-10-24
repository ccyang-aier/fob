import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'bun:test';
import type { Pool } from 'pg';
import { ResourceTransactionAbortedError, withFobIdentity, withKnowledgeBase, withProject } from './transaction';

const knowledgeBaseId = '11223344-5566-4788-99aa-bbccddeeff00';

function connection(query: (command: string) => Promise<{ command: string }>) {
  const client = new EventEmitter() as EventEmitter & {
    query: (command: string, values?: unknown[]) => Promise<{ command: string }>;
    release: (destroy?: boolean) => void;
  };
  const commands: string[] = [];
  const parameters: (unknown[] | undefined)[] = [];
  const releases: (boolean | undefined)[] = [];
  let checkouts = 0;
  client.query = async (command, values) => {
    commands.push(command);
    parameters.push(values);
    return query(command);
  };
  client.release = (destroy) => releases.push(destroy);
  const pool = { connect: async () => { checkouts += 1; return client; } } as unknown as Pool;
  return { client, pool, commands, parameters, releases, checkouts: () => checkouts };
}

describe('request resource transaction lifecycle', () => {
  test('validates knowledgeBase IDs before borrowing a connection', async () => {
    const testConnection = connection(async (command) => ({ command }));
    await expect(withKnowledgeBase(testConnection.pool, "bad'; RESET ALL; --", async () => undefined)).rejects.toThrow('Invalid knowledge base ID');
    expect(testConnection.checkouts()).toBe(0);
  });

  test('scope is a parameterized local setting on the borrowed connection', async () => {
    const testConnection = connection(async (command) => ({ command }));
    expect(await withKnowledgeBase(testConnection.pool, knowledgeBaseId, async () => 'committed')).toBe('committed');
    expect(testConnection.commands).toEqual(['BEGIN', "SELECT set_config('app.knowledge_base_id', $1, true), set_config('app.project_id', $2, true), set_config('app.auth_session_id', $3, true), set_config('app.read_knowledge_base_id', '', true)", 'COMMIT']);
    expect(testConnection.parameters[1]).toEqual([knowledgeBaseId, '', '']);
    expect(testConnection.releases).toEqual([false]);
    expect(testConnection.client.listenerCount('error')).toBe(0);
  });

  test('identity discovery is read-only and clears the resource setting', async () => {
    const testConnection = connection(async (command) => ({ command: command === 'BEGIN READ ONLY' ? 'BEGIN' : command }));
    await withFobIdentity(testConnection.pool, knowledgeBaseId, async () => undefined);
    expect(testConnection.commands[0]).toBe('BEGIN READ ONLY');
    expect(testConnection.parameters[1]).toEqual(['', '', knowledgeBaseId]);
    await expect(withFobIdentity(testConnection.pool, 'bad-session', async () => undefined)).rejects.toThrow('Invalid session ID');
    expect(testConnection.checkouts()).toBe(1);
  });

  test('project writes bind the project and verified identity while clearing knowledge-base scope', async () => {
    const testConnection = connection(async (command) => ({ command }));
    await withProject(testConnection.pool, knowledgeBaseId, knowledgeBaseId, async () => undefined);
    expect(testConnection.commands[0]).toBe('BEGIN');
    expect(testConnection.parameters[1]).toEqual(['', knowledgeBaseId, knowledgeBaseId]);
    expect(testConnection.releases).toEqual([false]);
    await expect(withProject(testConnection.pool, knowledgeBaseId, 'invalid-session', async () => undefined)).rejects.toThrow('Invalid session ID');
    expect(testConnection.checkouts()).toBe(1);
  });

  test('destroys a connection when BEGIN fails', async () => {
    const testConnection = connection(async () => { throw new Error('begin failed'); });
    await expect(withKnowledgeBase(testConnection.pool, knowledgeBaseId, async () => undefined)).rejects.toThrow('begin failed');
    expect(testConnection.commands).toEqual(['BEGIN']);
    expect(testConnection.releases).toEqual([true]);
  });

  test('rolls back callback failures and preserves the originating error', async () => {
    const testConnection = connection(async (command) => ({ command }));
    const original = new Error('callback failed');
    await expect(withKnowledgeBase(testConnection.pool, knowledgeBaseId, async () => { throw original; })).rejects.toBe(original);
    expect(testConnection.commands.at(-1)).toBe('ROLLBACK');
    expect(testConnection.releases).toEqual([false]);
  });

  test('destroys a connection when rollback fails', async () => {
    const testConnection = connection(async (command) => {
      if (command === 'ROLLBACK') throw new Error('socket closed');
      return { command };
    });
    const original = new Error('callback failed');
    await expect(withKnowledgeBase(testConnection.pool, knowledgeBaseId, async () => { throw original; })).rejects.toBe(original);
    expect(testConnection.releases).toEqual([true]);
  });

  test('does not mistake COMMIT returning ROLLBACK for success', async () => {
    const testConnection = connection(async (command) => ({ command: command === 'COMMIT' ? 'ROLLBACK' : command }));
    await expect(withKnowledgeBase(testConnection.pool, knowledgeBaseId, async () => 'uncommitted')).rejects.toBeInstanceOf(ResourceTransactionAbortedError);
    expect(testConnection.releases).toEqual([false]);
  });

  test('connection errors emitted during a callback are handled and destroy the client', async () => {
    const testConnection = connection(async (command) => ({ command }));
    await expect(withKnowledgeBase(testConnection.pool, knowledgeBaseId, async () => {
      testConnection.client.emit('error', new Error('server connection lost'));
    })).rejects.toThrow('server connection lost');
    expect(testConnection.commands.at(-1)).toBe('ROLLBACK');
    expect(testConnection.releases).toEqual([true]);
    expect(testConnection.client.listenerCount('error')).toBe(0);
  });
});
