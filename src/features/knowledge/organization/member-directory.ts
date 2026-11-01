import { organizationClient, type OrganizationListOptions, type OrganizationPage } from './client';
import { knowledgeCatalogClient } from '../data/knowledge-catalog-client';
import { OrganizationDataError } from './errors';

/** A directory must include every joined member, beyond the first API page. */
export async function allOrganizationPages<T>(load: (options: OrganizationListOptions) => Promise<OrganizationPage<T>>, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = [], visited = new Set<string>();
  let cursor: string | null = null;
  do {
    signal?.throwIfAborted();
    const page = await load({ cursor, limit: 100, signal });
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && visited.has(cursor)) throw new OrganizationDataError('ORGANIZATION_UNAVAILABLE');
    if (cursor) visited.add(cursor);
  } while (cursor);
  return items;
}

export async function knowledgeBaseMemberDirectory(knowledgeBaseId: string, signal: AbortSignal) {
  const [base, members] = await Promise.all([
    knowledgeCatalogClient.getKnowledgeBase(knowledgeBaseId, signal),
    allOrganizationPages(options => organizationClient.listMembers(knowledgeBaseId, options), signal),
  ]);
  return { role: base.role, members };
}
