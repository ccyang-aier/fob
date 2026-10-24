import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { projectSchema, projectMembersSchema, type Project, type ProjectMemberRole } from '@fob/shared/projects';
import { registerProjectFixtures } from './i18n/display';

type ProjectPage = { items: Project[]; nextCursor: string | null };

export class ProjectRequestError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}

async function request<T>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const { origin } = await getFobApiOrigin();
  const response = await authenticatedFetch(`${origin}/api/projects${path}`, {
    method,
    signal,
    ...(method === 'GET'
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new ProjectRequestError(
      typeof payload === 'object' && payload !== null && 'code' in payload ? String(payload.code) : 'UNAVAILABLE', response.status,
      typeof payload === 'object' &&
        payload !== null &&
        'message' in payload &&
        typeof payload.message === 'string'
        ? payload.message
        : '项目服务暂不可用',
    );
  return payload as T;
}

export const projectClient = {
  async members(projectId: string, signal?: AbortSignal) {
    return projectMembersSchema.parse(await request(`/${projectId}/members`, 'GET', undefined, signal));
  },
  async addMember(projectId: string, email: string, role: ProjectMemberRole) {
    return projectMembersSchema.parse(await request(`/${projectId}/members`, 'POST', { email, role }));
  },
  async updateMember(projectId: string, userId: string, role: ProjectMemberRole) {
    return projectMembersSchema.parse(await request(`/${projectId}/members/${userId}`, 'PATCH', { role }));
  },
  async removeMember(projectId: string, userId: string) {
    return projectMembersSchema.parse(await request(`/${projectId}/members/${userId}`, 'DELETE'));
  },
  async list(signal?: AbortSignal) {
    const items: Project[] = [];
    let cursor: string | null = null;
    do {
      const page: ProjectPage = await request(
        `${cursor ? `?cursor=${cursor}` : ''}`,
        'GET',
        undefined,
        signal,
      );
      items.push(...page.items.map((item) => projectSchema.parse(item)));
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  },
  async create(name: string) {
    return projectSchema.parse(await request('', 'POST', { name }));
  },
  async rename(projectId: string, name: string) {
    return projectSchema.parse(await request(`/${projectId}`, 'PATCH', { name }));
  },
  async remove(projectId: string) {
    await request(`/${projectId}`, 'DELETE');
  },
};

registerProjectFixtures([projectClient]);
