'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './notification-bell.messages';
/**
 * The notification bell (N03): the shell's live trigger over the knowledge
 * bridge. While a knowledge knowledgeBase is open it renders the real inbox —
 * unread highlighting, per-item and mark-all read actions, jump-to-page on
 * click — and live updates arrive through the same snapshot the B06 knowledgeBase
 * events invalidate. Without a published knowledgeBase it degrades to an inert
 * bell that simply opens the knowledge workbench, never inventing data.
 */

import { useMemo, useState } from 'react';
import { useSyncExternalStore } from 'react';
import {
  At,
  BellRinging,
  BellSimple,
  BellSlash,
  ChatsCircle,
  Check,
  Checks,
  WarningCircle,
} from '@phosphor-icons/react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import {
  readKnowledgeNotifications,
  subscribeKnowledgeNotifications,
} from '../notifications-bridge';
import {
  deriveNotificationRows,
  notificationBadgeText,
  notificationSubtitle,
  notificationVerb,
} from '../notifications-view-model';

export function KnowledgeNotificationBell({ onOpenWorkbench }: { onOpenWorkbench?: () => void }) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const snapshot = useSyncExternalStore(
    subscribeKnowledgeNotifications,
    readKnowledgeNotifications,
    () => null,
  );
  const [open, setOpen] = useState(false);
  // Pending markers are stamped with the snapshot they were raised against: a
  // fresh publish (the refetched truth) drops them without an extra effect.
  const [pending, setPending] = useState<{
    stamp: unknown;
    ids: ReadonlySet<string>;
    all: boolean;
  } | null>(null);

  const rows = useMemo(
    () => deriveNotificationRows(snapshot?.items ?? [], new Date(), locale),
    [snapshot, locale],
  );
  const unreadCount = snapshot?.unreadCount ?? 0;
  const badge = notificationBadgeText(unreadCount);
  const rowPending = (id: string) => pending?.stamp === snapshot && pending.ids.has(id);
  const allPending = pending?.stamp === snapshot && pending.all;

  const withPending = (id: string, run: () => void) => {
    setPending((current) => ({
      stamp: snapshot,
      ids: new Set([...(current?.stamp === snapshot ? current.ids : []), id]),
      all: current?.stamp === snapshot ? current.all : false,
    }));
    run();
  };

  // Inert state: no live knowledge knowledgeBase → the bell just opens the workbench.
  if (!snapshot) {
    return (
      <button
        type="button"
        aria-label={knowledgeT('notifications')}
        title={knowledgeT('openAKnowledgeBaseToViewNotifications')}
        onClick={onOpenWorkbench}
        className="relative flex size-7 items-center justify-center rounded-[7px] text-[var(--muted-strong)] outline-none transition-colors hover:bg-wash hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <BellSimple className="size-[15px]" weight="duotone" aria-hidden />
      </button>
    );
  }

  const openItem = (row: { id: string; targetPageId: string | null; unread: boolean }) => {
    if (row.unread) withPending(row.id, () => snapshot.markRead(row.id));
    snapshot.openPage(row.targetPageId);
    onOpenWorkbench?.();
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={
            unreadCount > 0
              ? knowledgeT(
                  unreadCount === 1 ? 'oneUnreadNotification' : 'valueUnreadNotifications',
                  { v0: unreadCount },
                )
              : knowledgeT('notifications')
          }
          title={knowledgeT('notifications')}
          className="relative flex size-7 items-center justify-center rounded-[7px] text-[var(--muted-strong)] outline-none transition-colors hover:bg-wash hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] data-[state=open]:bg-wash data-[state=open]:text-[var(--ink)]"
        >
          <BellSimple
            className={cn('size-[15px]', unreadCount > 0 && 'text-[var(--accent-ink)]')}
            weight="duotone"
            aria-hidden
          />
          {badge ? (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-[13px] min-w-[13px] items-center justify-center rounded-full border border-panel bg-[var(--accent)] px-[3px] text-[8.5px] font-semibold leading-none text-[var(--accent-contrast,var(--panel))] shadow-[0_1px_2px_rgba(20,24,28,0.18)]"
            >
              {badge}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-[338px] rounded-[7px] p-0">
        <header className="flex items-center gap-2.5 border-b border-[var(--line)] px-3.5 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-[var(--accent-soft-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]">
            <BellRinging aria-hidden className="size-4" weight="duotone" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
              {knowledgeT('notifications')}
            </p>
            <p className="mt-0.5 text-[9.5px] text-[var(--muted)]">
              {notificationSubtitle(unreadCount, locale)}
            </p>
          </div>
          <span className="ml-auto rounded-full border border-[var(--line)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[9px] font-medium text-[var(--muted-strong)]">
            {knowledgeT('live')}
          </span>
        </header>

        <div className="max-h-[318px] overflow-y-auto p-1.5">
          {snapshot.status === 'loading' && rows.length === 0 ? (
            <p className="px-2.5 py-4 text-center text-[11px] text-[var(--muted)]">
              {knowledgeT('loadingNotifications')}
            </p>
          ) : snapshot.status === 'error' && rows.length === 0 ? (
            <p
              className="flex items-center justify-center gap-1.5 px-2.5 py-4 text-[11px] text-[var(--err-ink)]"
              role="alert"
            >
              <WarningCircle aria-hidden className="size-3.5" weight="fill" />
              {knowledgeT('notificationsAreUnavailableRetryingAutomatically')}
            </p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-2.5 py-6 text-center">
              <BellSlash aria-hidden className="size-5 text-[var(--muted)]" weight="duotone" />
              <p className="text-[11px] text-[var(--muted)]">{knowledgeT('noNotifications')}</p>
              <p className="text-[9.5px] text-[var(--muted-strong)]">
                {knowledgeT('commentRepliesAndMentionsAppearHereInReal')}
              </p>
            </div>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="group/notice relative">
                <button
                  type="button"
                  onClick={() => openItem(row)}
                  aria-label={knowledgeT('valueValueOnPageValue', {
                    v0: row.actorName,
                    v1: notificationVerb(row.kind, locale),
                    v2: row.pageLabel,
                  })}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2.5 text-left outline-none transition-colors hover:bg-wash focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                    row.unread && 'bg-[color-mix(in_srgb,var(--accent-soft)_45%,transparent)]',
                    rowPending(row.id) && 'opacity-60',
                  )}
                >
                  {row.unread ? (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[var(--accent)]"
                    />
                  ) : null}
                  <span
                    className={cn(
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[7px]',
                      row.kind === 'comment.mention'
                        ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)]'
                        : 'bg-[var(--surface-subtle)] text-[var(--muted-strong)]',
                    )}
                  >
                    {row.kind === 'comment.mention' ? (
                      <At aria-hidden className="size-3.5" weight="bold" />
                    ) : (
                      <ChatsCircle aria-hidden className="size-3.5" weight="fill" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          'truncate text-[11px] text-[var(--ink)]',
                          row.unread && 'font-medium',
                        )}
                      >
                        <span className="font-semibold">{row.actorName}</span>{' '}
                        {notificationVerb(row.kind)}
                      </span>
                      <span className="ml-auto shrink-0 text-[9px] text-[var(--muted)]">
                        {row.timeText}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[9.5px] text-[var(--muted)]">
                      {row.pageLabel}
                    </span>
                  </span>
                </button>
                {row.unread ? (
                  <button
                    type="button"
                    title={knowledgeT('markAsRead')}
                    aria-label={knowledgeT('markNotificationFromValueAsRead', {
                      v0: row.actorName,
                    })}
                    onClick={(event) => {
                      event.stopPropagation();
                      withPending(row.id, () => snapshot.markRead(row.id));
                    }}
                    className="absolute right-1.5 top-1.5 hidden size-5 items-center justify-center rounded-[5px] text-[var(--muted-strong)] outline-none transition-colors hover:bg-panel hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] group-hover/notice:flex"
                  >
                    <Check aria-hidden className="size-3" weight="bold" />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setPending((current) => ({
              stamp: snapshot,
              ids: current?.stamp === snapshot ? current.ids : new Set<string>(),
              all: true,
            }));
            snapshot.markAllRead();
          }}
          disabled={unreadCount === 0 || allPending}
          className="flex h-9 w-full items-center justify-center gap-1.5 border-t border-[var(--line)] bg-[var(--surface-subtle)] text-[10.5px] font-medium text-[var(--accent-ink)] outline-none transition-colors hover:bg-[var(--accent-soft)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] disabled:cursor-default disabled:text-[var(--muted)] disabled:hover:bg-[var(--surface-subtle)]"
        >
          <Checks aria-hidden className="size-3" weight="bold" />
          {allPending ? knowledgeT('working') : knowledgeT('markAllAsRead')}
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
