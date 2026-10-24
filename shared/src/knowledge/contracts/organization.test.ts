import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { acceptKnowledgeBaseInvitationInputSchema, createKnowledgeBaseInputSchema, createKnowledgeBaseInvitationInputSchema, changeMemberRoleInputSchema, listOrganizationInputSchema } from './organization';
import { createTeamspaceInputSchema, teamspaceScopeSchema, updateTeamspaceInputSchema } from './organization';
import { listKnowledgeBasesInputSchema } from './organization';


test('organization mutations reject injected actor identity and owner invitations', () => {
  const knowledgeBaseId = randomUUID();
  assert.equal(createKnowledgeBaseInputSchema.safeParse({ name: 'Personal', userId: randomUUID() }).success, false);
  assert.equal(createKnowledgeBaseInvitationInputSchema.safeParse({ knowledgeBaseId, email: 'a@example.test', role: 'owner' }).success, false);
  assert.equal(createKnowledgeBaseInvitationInputSchema.parse({ knowledgeBaseId, email: 'A@EXAMPLE.TEST', role: 'member' }).email, 'a@example.test');
  assert.equal(changeMemberRoleInputSchema.safeParse({ knowledgeBaseId, userId: randomUUID(), role: 'admin', actorUserId: randomUUID() }).success, false);
  assert.equal(acceptKnowledgeBaseInvitationInputSchema.safeParse({ knowledgeBaseId, invitationId: randomUUID(), token: 'short' }).success, false);
  assert.equal(listOrganizationInputSchema.parse({ knowledgeBaseId }).limit, 50);
  assert.equal(listOrganizationInputSchema.safeParse({ knowledgeBaseId, limit: 101 }).success, false);
});

test('teamspace inputs preserve null defaults, explicit patches and server-owned identity', () => {
  const knowledgeBaseId = randomUUID();
  const teamspaceId = randomUUID();
  assert.equal(createTeamspaceInputSchema.parse({ knowledgeBaseId, name: '  Research  ' }).defaultAccess, null);
  assert.equal(createTeamspaceInputSchema.parse({ knowledgeBaseId, name: '  Research  ' }).name, 'Research');
  assert.equal(createTeamspaceInputSchema.safeParse({ knowledgeBaseId, name: 'Research', id: teamspaceId }).success, false);
  assert.equal(createTeamspaceInputSchema.safeParse({ knowledgeBaseId, name: 'Research', userId: randomUUID() }).success, false);
  assert.equal(updateTeamspaceInputSchema.safeParse({ knowledgeBaseId, teamspaceId }).success, false);
  assert.equal(updateTeamspaceInputSchema.parse({ knowledgeBaseId, teamspaceId, defaultAccess: null }).defaultAccess, null);
  assert.equal(updateTeamspaceInputSchema.safeParse({ knowledgeBaseId, teamspaceId, defaultAccess: 'owner' }).success, false);
  assert.equal(updateTeamspaceInputSchema.safeParse({ knowledgeBaseId, teamspaceId, name: ' ' }).success, false);
  assert.equal(teamspaceScopeSchema.safeParse({ knowledgeBaseId, teamspaceId: 'invalid' }).success, false);
});

test('knowledge-base creation and discovery need no enclosing project or workspace', () => {
  assert.deepEqual(createKnowledgeBaseInputSchema.parse({ name: 'Research' }), { name: 'Research' });
  assert.equal(createKnowledgeBaseInputSchema.safeParse({ name: 'Research', projectIds: [randomUUID()] }).success, false);
  assert.equal(createKnowledgeBaseInputSchema.safeParse({ name: 'Research', projectId: randomUUID() }).success, false);
  assert.equal(listKnowledgeBasesInputSchema.parse({}).limit, 50);
  assert.equal(listKnowledgeBasesInputSchema.parse({ cursor: randomUUID(), limit: 10 }).limit, 10);
  assert.equal(listKnowledgeBasesInputSchema.safeParse({ projectId: randomUUID() }).success, false);
  assert.equal(listKnowledgeBasesInputSchema.safeParse({ workspaceId: randomUUID() }).success, false);
});
