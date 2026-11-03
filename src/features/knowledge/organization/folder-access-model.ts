import { permissionLevels } from '@fob/shared/knowledge/contracts';
import type { FolderAccessPolicy, KnowledgeBaseMemberSummary, PermissionLevel } from '@fob/shared/knowledge/contracts';

export function folderRows(folders: readonly FolderAccessPolicy[], search: string, collapsed: ReadonlySet<string>) {
  const byId = new Map(folders.map((folder) => [folder.teamspaceId, folder]));
  const children = new Map<string | null, FolderAccessPolicy[]>();
  for (const folder of folders) {
    const parent = folder.parentId && byId.has(folder.parentId) ? folder.parentId : null;
    const list = children.get(parent) ?? []; list.push(folder); children.set(parent, list);
  }
  const visible = new Set<string>();
  if (search) for (const folder of folders.filter((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))) {
    let current: FolderAccessPolicy | undefined = folder;
    const seen = new Set<string>();
    while (current && !seen.has(current.teamspaceId)) { seen.add(current.teamspaceId); visible.add(current.teamspaceId); current = current.parentId ? byId.get(current.parentId) : undefined; }
  }
  const rows: { folder: FolderAccessPolicy; depth: number; hasChildren: boolean }[] = [];
  const seen = new Set<string>();
  function visit(parent: string | null, depth: number) {
    for (const folder of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      if (seen.has(folder.teamspaceId)) continue; seen.add(folder.teamspaceId);
      if (search && !visible.has(folder.teamspaceId)) continue;
      rows.push({ folder, depth, hasChildren: children.has(folder.teamspaceId) });
      if (search || !collapsed.has(folder.teamspaceId)) visit(folder.teamspaceId, depth + 1);
    }
  }
  visit(null, 0); return rows;
}

/** A directory preview, not a replacement for the document authorization check. */
export function folderPermissionFor(folder: FolderAccessPolicy, member: Pick<KnowledgeBaseMemberSummary, 'userId' | 'role'>) {
  const direct = folder.grants.find((grant) => grant.userId === member.userId);
  const baseline = member.role === 'guest' ? null : folder.effectiveDefaultAccess;
  if (direct && (!baseline || permissionLevels.indexOf(direct.level) >= permissionLevels.indexOf(baseline))) return { level: direct.level as PermissionLevel | null, sourceId: direct.sourceId, individual: true };
  return { level: baseline, sourceId: folder.defaultSourceId, individual: false };
}
