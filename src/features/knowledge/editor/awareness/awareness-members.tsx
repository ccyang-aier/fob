'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './awareness-members.messages';

/**
 * The online-members bar of the page header (B07): a compact avatar stack of
 * unique accounts and agent tasks, plus the current user. The dropdown
 * exposes names and live editing status without crowding the document.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { Sparkle } from '@/components/icons';
import type { Awareness } from 'y-protocols/awareness';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserAvatar } from '@/components/user-avatar';
import { awarenessColorFor, readAwarenessMembers } from '../../collaboration/awareness';
import type { AwarenessIdentity, AwarenessMember } from '../../collaboration/awareness';
import styles from './awareness-members.module.css';

interface AwarenessMembersSnapshot {
  members: AwarenessMember[];
  ownClientId: number;
}

const emptySnapshot: AwarenessMembersSnapshot = { members: [], ownClientId: 0 };

/**
 * Cached snapshots per awareness instance: `useSyncExternalStore` requires a
 * stable value until the store reports a change, and the awareness is that
 * store (the 'change' event covers additions, updates and removals).
 */
const snapshotCache = new WeakMap<Awareness, AwarenessMembersSnapshot>();

function awarenessSnapshot(awareness: Awareness): AwarenessMembersSnapshot {
  const cached = snapshotCache.get(awareness);
  if (cached) return cached;
  const snapshot: AwarenessMembersSnapshot = {
    members: readAwarenessMembers(awareness, awareness.clientID),
    ownClientId: awareness.clientID,
  };
  snapshotCache.set(awareness, snapshot);
  return snapshot;
}

/** Live members of one page session's awareness; empty while there is none. */
export function useAwarenessMembers(awareness: Awareness | null): AwarenessMembersSnapshot {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!awareness) return () => {};
      snapshotCache.delete(awareness);
      const onChange = () => {
        snapshotCache.delete(awareness);
        notify();
      };
      awareness.on('change', onChange);
      return () => {
        awareness.off('change', onChange);
      };
    },
    [awareness],
  );
  const getSnapshot = useCallback(
    () => (awareness ? awarenessSnapshot(awareness) : emptySnapshot),
    [awareness],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => emptySnapshot);
}

const MAX_VISIBLE = 3;

function memberKey(member: AwarenessMember): string {
  return JSON.stringify([
    member.kind,
    member.user.id,
    member.kind === 'agent' ? (member.taskId ?? member.clientId) : null,
  ]);
}

function MemberAvatar({ member, large = false }: { member: AwarenessMember; large?: boolean }) {
  const { t } = useTranslation(knowledgeMessages);
  const image = member.user.image;
  return (
    <span
      title={`${member.user.name} · ${t(member.isEditing ? 'editing' : 'online')}`}
      className={cn(styles.avatar, large && styles.largeAvatar)}
    >
      <UserAvatar name={member.user.name} image={image} className="size-full" />
      {member.kind === 'agent' && (
        <span aria-hidden className={styles.agentBadge}>
          <Sparkle aria-hidden size={9} />
        </span>
      )}
    </span>
  );
}

/** One unified header stack, with a keyboard-accessible live member list. */
export function AwarenessMembers({
  awareness,
  identity,
}: {
  awareness: Awareness | null;
  identity: AwarenessIdentity;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const { members } = useAwarenessMembers(awareness);
  const own: AwarenessMember = {
    clientId: awareness?.clientID ?? 0,
    user: { id: identity.userId, name: identity.name, image: identity.image },
    color: awarenessColorFor(identity.userId),
    kind: 'human',
    isEditing: false,
  };
  const participants = [
    own,
    ...members.filter((member) => member.kind !== 'human' || member.user.id !== identity.userId),
  ];
  const visible = participants.slice(0, MAX_VISIBLE);
  const overflow = participants.length - visible.length;
  const label = awareness
    ? knowledgeT(participants.length === 1 ? 'oneMemberOnline' : 'valueMembersOnline', {
        v0: participants.length,
      })
    : knowledgeT('currentDocumentMembers');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={knowledgeT('viewDocumentMembers')}
          className={styles.trigger}
        >
          <span aria-hidden className={styles.stack}>
            {visible.map((member) => (
              <MemberAvatar key={memberKey(member)} member={member} />
            ))}
            {overflow > 0 ? (
              <span
                className={styles.overflow}
                title={knowledgeT(
                  overflow === 1 ? 'oneMoreMemberOnline' : 'valueMoreMembersOnline',
                  { v0: overflow },
                )}
              >
                {overflow > 99 ? '99+' : `+${overflow}`}
              </span>
            ) : null}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={9}
        className={styles.menu}
        aria-label={knowledgeT('documentMembers')}
      >
        <div className={styles.menuHeading}>
          <span>{knowledgeT('documentMembers')}</span>
          <span className={styles.total}>{participants.length}</span>
        </div>
        <div className={styles.members}>
          {participants.map((member, index) => (
            <DropdownMenuItem
              key={memberKey(member)}
              className={styles.memberRow}
              onSelect={(event) => event.preventDefault()}
            >
              <MemberAvatar member={member} large />
              <span className={styles.memberInfo}>
                <span className={styles.memberName}>
                  <span className={styles.name}>{member.user.name}</span>
                  {index === 0 ? <span className={styles.you}>{knowledgeT('you')}</span> : null}
                  {member.kind === 'agent' ? (
                    <span className={styles.agentLabel}>{knowledgeT('ai')}</span>
                  ) : null}
                </span>
                <span className={cn(styles.memberStatus, member.isEditing && styles.editing)}>
                  <span aria-hidden className={styles.statusDot} />
                  {index === 0
                    ? knowledgeT('currentDocument')
                    : member.isEditing
                      ? knowledgeT('editing')
                      : knowledgeT('viewing')}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
