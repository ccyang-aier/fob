import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { principal } from '@fob/shared/knowledge/contracts';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, until, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { pageDocumentName } from '@fob/shared/knowledge/collaboration';
import { createPageCollaborationListener } from './page-collaboration-bun';
import type { PageCollaborationListener } from './page-collaboration-bun';
import { createAgentAwarenessSession } from './agent-awareness';

/** Server-side agent presence over the real listener, observed by a protocol client. */
describe('server-side agent awareness publication', () => {
  let fixture: PermissionsFixture;
  let listener: PageCollaborationListener;

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
    listener = createPageCollaborationListener(
      { authenticator: fixture.authenticator, pool: fixture.pool },
      { persistence: { debounceMs: 120, maxDebounceMs: 400 } },
    );
  });
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    await listener.close();
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
  });

  async function grantEdit(pageId: string) {
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replaceAuthorizedPageAcl(db, {
      knowledgeBaseId: fixture.alpha.id, pageId, grants: [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }],
    }));
    await fixture.drain();
  }

  test('a human peer sees the agent cursor and its removal', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grantEdit(pages[0].pageId);
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId });

    const { connectCollaborationClient } = await import('../../../../../../qa/helpers/collaboration-client');
    const peer = connectCollaborationClient({ port: listener.port, origin: fixture.server.webOrigin, name, authorization: fixture.reader.cookie });
    await until(async () => peer.synced());

    const session = await createAgentAwarenessSession(listener.hocuspocus, {
      documentName: name,
      identity: { userId: fixture.owner.identity.userId, taskId: crypto.randomUUID(), name: 'Research Agent', color: '#3b82f6' },
    });
    session.publish({ cursor: { anchor: 'block-1', head: 'block-2' }, isEditing: true });

    await until(async () => {
      const states = peer.provider.awareness?.getStates() ?? new Map();
      for (const state of states.values()) {
        if ((state as { kind?: string })?.kind === 'agent') return true;
      }
      return false;
    });
    const agentState = [...(peer.provider.awareness?.getStates() ?? new Map()).values()].find((state) => (state as { kind?: string })?.kind === 'agent') as Record<string, unknown>;
    expect(agentState).toMatchObject({ kind: 'agent', color: '#3b82f6', isEditing: true, cursor: { anchor: 'block-1', head: 'block-2' } });
    expect((agentState.user as { id: string }).id).toBe(fixture.owner.identity.userId);
    expect(typeof agentState.taskId).toBe('string');

    await session.stop();
    await until(async () => {
      const states = peer.provider.awareness?.getStates() ?? new Map();
      return [...states.values()].every((state) => (state as { kind?: string })?.kind !== 'agent');
    });
    await peer.destroy();
  });

  test('aborting the task signal clears presence and closes the session', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    await grantEdit(pages[0].pageId);
    const name = pageDocumentName({ knowledgeBaseId: fixture.alpha.id, pageId: pages[2].pageId });

    const controller = new AbortController();
    const session = await createAgentAwarenessSession(listener.hocuspocus, {
      documentName: name,
      identity: { userId: fixture.owner.identity.userId, taskId: crypto.randomUUID(), name: 'Summarizer', color: '#f97316' },
      signal: controller.signal,
    });
    session.publish({ isEditing: true });

    const { connectCollaborationClient } = await import('../../../../../../qa/helpers/collaboration-client');
    const peer = connectCollaborationClient({ port: listener.port, origin: fixture.server.webOrigin, name, authorization: fixture.reader.cookie });
    await until(async () => {
      const states = peer.provider.awareness?.getStates() ?? new Map();
      return [...states.values()].some((state) => (state as { kind?: string })?.kind === 'agent');
    });

    controller.abort();
    await until(async () => {
      const states = peer.provider.awareness?.getStates() ?? new Map();
      return [...states.values()].every((state) => (state as { kind?: string })?.kind !== 'agent');
    });
    expect(() => session.publish({ isEditing: false })).toThrow('already stopped');
    await peer.destroy();
  });

  test('non-page document names are rejected before any connection opens', async () => {
    await expect(createAgentAwarenessSession(listener.hocuspocus, {
      documentName: `knowledgeBase:${fixture.alpha.id}`,
      identity: { userId: fixture.owner.identity.userId, taskId: crypto.randomUUID(), name: 'Agent', color: '#22c55e' },
    })).rejects.toThrow('strict page document name');
  });
});
