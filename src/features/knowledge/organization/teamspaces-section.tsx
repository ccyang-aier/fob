'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './teamspaces-section.messages';
/**
 * Teamspace management (O02): create / rename / delete teamspaces and edit the
 * root default access (`view/comment/edit/full` or null). Changing the default
 * on an existing teamspace first shows the P02 rebuild notice and requires an
 * explicit confirmation: existing grants fail immediately and a rebuild
 * restores access under the new default.
 */

import { useState } from 'react';
import { FolderOpen, PencilSimple, ShieldCheck, Trash } from '@/components/icons';
import { cn } from '@/lib/utils';
import { validateOrganizationName } from '@/features/knowledge/organization/client';
import type { MemberRole } from '@/features/knowledge/organization/client';
import type { TeamspaceAccess } from '../data/knowledge-catalog-client';
import {
  useCreateTeamspaceMutation,
  useRemoveTeamspaceMutation,
  useTeamspacesQuery,
  useUpdateTeamspaceMutation,
} from './hooks';
import type { TeamspaceRow } from './list-mutations';
import {
  canManageOrganization,
  defaultAccessOptions,
  defaultAccessRebuildNotice,
  needsAccessRebuildConfirmation,
} from './view-model';
import {
  AccessBadge,
  ConfirmDialog,
  DialogButton,
  ListStateShell,
  LoadMoreButton,
  ModalDialog,
  NameField,
  SectionHeader,
  flattenPages,
  mutationErrorText,
  queryListState,
} from './ui';

export function TeamspacesSection({
  knowledgeBaseId,
  actorRole,
  notify,
}: {
  knowledgeBaseId: string;
  actorRole: MemberRole;
  notify: (kind: 'success' | 'error', text: string) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const canManage = canManageOrganization(actorRole);
  const teamspacesQuery = useTeamspacesQuery(knowledgeBaseId);
  const createMutation = useCreateTeamspaceMutation(knowledgeBaseId);
  const updateMutation = useUpdateTeamspaceMutation(knowledgeBaseId);
  const removeMutation = useRemoveTeamspaceMutation(knowledgeBaseId);
  const [creating, setCreating] = useState(false);
  const [accessTarget, setAccessTarget] = useState<TeamspaceRow | null>(null);
  const [renaming, setRenaming] = useState<TeamspaceRow | null>(null);
  const [deleting, setDeleting] = useState<TeamspaceRow | null>(null);
  const teamspaces = flattenPages<TeamspaceRow>(teamspacesQuery.data);

  async function applyAccess(target: TeamspaceRow, access: TeamspaceAccess) {
    try {
      await updateMutation.mutateAsync({ id: target.id, patch: { defaultAccess: access } });
      notify(
        'success',
        knowledgeT('defaultAccessForValueUpdatedRecalculatingPagePermissions', { v0: target.name }),
      );
      setAccessTarget(null);
    } catch (error) {
      notify('error', mutationErrorText(knowledgeT('changeDefaultAccess'), error));
    }
  }

  async function rename(target: TeamspaceRow, name: string) {
    try {
      await updateMutation.mutateAsync({ id: target.id, patch: { name } });
      notify('success', knowledgeT('folderRenamed'));
      setRenaming(null);
    } catch (error) {
      notify('error', mutationErrorText(knowledgeT('renameFolder'), error));
    }
  }

  async function remove() {
    const target = deleting;
    if (!target) return;
    try {
      await removeMutation.mutateAsync(target.id);
      notify('success', knowledgeT('folderValueDeleted', { v0: target.name }));
      setDeleting(null);
    } catch (error) {
      notify('error', mutationErrorText(knowledgeT('deleteFolder'), error));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionHeader
        title={knowledgeT('folder')}
        hint={knowledgeT('aTopLevelPageContainerDefaultAccessDetermines')}
        action={
          canManage ? (
            <DialogButton variant="primary" onClick={() => setCreating(true)}>
              {knowledgeT('newFolder')}
            </DialogButton>
          ) : undefined
        }
      />
      <ListStateShell
        state={queryListState(teamspacesQuery)}
        error={teamspacesQuery.error}
        onRetry={() => void teamspacesQuery.refetch()}
        emptyIcon={<FolderOpen className="size-6" aria-hidden />}
        emptyTitle={knowledgeT('noFoldersYet')}
        emptyHint={knowledgeT('foldersContainTopLevelPagesDefaultAccessDetermines')}
        emptyAction={
          canManage ? (
            <DialogButton variant="primary" onClick={() => setCreating(true)}>
              {knowledgeT('newFolder')}
            </DialogButton>
          ) : undefined
        }
      >
        <div className="overflow-hidden rounded-[10px] border border-[var(--line)] bg-panel">
          {teamspaces.map((teamspace) => (
            <div
              key={teamspace.id}
              className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--surface-subtle)]"
            >
              <FolderOpen className="size-4 shrink-0 text-[var(--muted-strong)]" />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-[var(--ink)]">
                  {teamspace.name}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
                  {knowledgeT('defaultAccess')}
                  <AccessBadge access={teamspace.defaultAccess} />
                </span>
              </div>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setAccessTarget(teamspace)}
                    className="flex h-[26px] items-center gap-1.5 rounded-[6px] border border-[var(--line)] bg-panel px-2 text-[10.5px] font-medium text-[var(--muted-strong)] outline-none transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-subtle)] hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  >
                    <ShieldCheck className="size-3.5" />
                    {knowledgeT('defaultPermissions')}
                  </button>
                  <RowIconAction
                    label={knowledgeT('renameFolderValue', { v0: teamspace.name })}
                    title={knowledgeT('rename')}
                    onClick={() => setRenaming(teamspace)}
                  >
                    <PencilSimple className="size-[14px]" />
                  </RowIconAction>
                  <RowIconAction
                    label={knowledgeT('deleteFolderValue', { v0: teamspace.name })}
                    title={knowledgeT('delete')}
                    danger
                    onClick={() => setDeleting(teamspace)}
                  >
                    <Trash className="size-[14px]" />
                  </RowIconAction>
                </div>
              ) : null}
            </div>
          ))}
          <LoadMoreButton
            visible={teamspacesQuery.hasNextPage}
            loading={teamspacesQuery.isFetchingNextPage}
            onClick={() => void teamspacesQuery.fetchNextPage()}
          />
        </div>
      </ListStateShell>

      <CreateTeamspaceDialog
        open={creating}
        busy={createMutation.isPending}
        onClose={() => setCreating(false)}
        onSubmit={async (name, defaultAccess) => {
          try {
            const created = await createMutation.mutateAsync({ name, defaultAccess });
            notify('success', knowledgeT('folderValueCreated', { v0: created.name }));
            setCreating(false);
          } catch (error) {
            notify('error', mutationErrorText(knowledgeT('createFolder'), error));
          }
        }}
      />
      <AccessDialog
        key={accessTarget?.id ?? 'none'}
        teamspace={accessTarget}
        busy={updateMutation.isPending}
        onClose={() => setAccessTarget(null)}
        onConfirm={(access) => accessTarget && void applyAccess(accessTarget, access)}
      />
      <RenameTeamspaceDialog
        key={renaming?.id ?? 'none'}
        teamspace={renaming}
        busy={updateMutation.isPending}
        onClose={() => setRenaming(null)}
        onSubmit={(name) => renaming && void rename(renaming, name)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
        busy={removeMutation.isPending}
        title={knowledgeT('deleteFolder')}
        confirmLabel={knowledgeT('delete')}
        body={
          deleting ? (
            <>
              {knowledgeT('deleteFolder2')}
              <strong className="font-semibold text-[var(--ink)]">{deleting.name}</strong>
              {knowledgeT('onlyFoldersWithNoPagesIncludingTrashedPages')}
            </>
          ) : null
        }
      />
    </div>
  );
}

function RowIconAction({
  label,
  title,
  onClick,
  danger,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded-[6px] text-[var(--muted)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
        danger
          ? 'hover:bg-[color-mix(in_srgb,var(--err-ink)_9%,transparent)] hover:text-[var(--err-ink)]'
          : 'hover:bg-wash hover:text-[var(--ink)]',
      )}
    >
      {children}
    </button>
  );
}

/** Radio list of the four levels plus "explicit only" (null). */
function AccessOptions({
  value,
  onChange,
  disabled,
}: {
  value: TeamspaceAccess;
  onChange: (value: TeamspaceAccess) => void;
  disabled?: boolean;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <div
      className="flex flex-col gap-1.5"
      role="radiogroup"
      aria-label={knowledgeT('defaultAccess')}
    >
      {defaultAccessOptions(locale).map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-start gap-2.5 rounded-[8px] border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-45',
              selected
                ? 'border-[var(--accent-soft-line)] bg-[var(--accent-soft)]'
                : 'border-[var(--line)] bg-panel hover:border-[var(--line-strong)] hover:bg-[var(--surface-subtle)]',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                selected ? 'border-[var(--accent)]' : 'border-[var(--line-strong)]',
              )}
            >
              {selected ? <span className="size-1.5 rounded-full bg-[var(--accent)]" /> : null}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  'block text-[11.5px] font-medium',
                  selected ? 'text-[var(--accent-ink)]' : 'text-[var(--ink)]',
                )}
              >
                {option.label}
              </span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-[var(--muted)]">
                {option.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CreateTeamspaceDialog({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string, defaultAccess: TeamspaceAccess) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [name, setName] = useState('');
  const [access, setAccess] = useState<TeamspaceAccess>(null);
  const [touched, setTouched] = useState(false);
  const validation = validateOrganizationName(name);
  function close() {
    onClose();
    setName('');
    setAccess(null);
    setTouched(false);
  }
  function submit() {
    setTouched(true);
    if (validation.ok) onSubmit(validation.value, access);
  }
  return (
    <ModalDialog
      open={open}
      onClose={close}
      title={knowledgeT('newFolder')}
      width="w-[480px]"
      footer={
        <>
          <DialogButton onClick={close}>{knowledgeT('cancel')}</DialogButton>
          <DialogButton variant="primary" disabled={!validation.ok || busy} onClick={submit}>
            {busy ? knowledgeT('creating') : knowledgeT('create')}
          </DialogButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <NameField
          label={knowledgeT('name')}
          value={name}
          onChange={(value) => {
            setName(value);
            setTouched(true);
          }}
          onSubmit={submit}
          placeholder={knowledgeT('eGProductDocumentation')}
          autoFocus
          invalidReason={touched && !validation.ok ? validation.reason : undefined}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-[var(--muted-strong)]">
            {knowledgeT('defaultAccess')}
          </span>
          <AccessOptions value={access} onChange={setAccess} />
        </div>
      </div>
    </ModalDialog>
  );
}

function AccessDialog({
  teamspace,
  busy,
  onClose,
  onConfirm,
}: {
  teamspace: TeamspaceRow | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (access: TeamspaceAccess) => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const [access, setAccess] = useState<TeamspaceAccess>(teamspace?.defaultAccess ?? null);
  const current = teamspace?.defaultAccess ?? null;
  const changed = teamspace !== null && needsAccessRebuildConfirmation(current, access);
  return (
    <ModalDialog
      open={teamspace !== null}
      onClose={onClose}
      title={knowledgeT('defaultAccess')}
      description={
        teamspace
          ? knowledgeT('allRootPagesInValueWillBeAccessible', { v0: teamspace.name })
          : undefined
      }
      width="w-[480px]"
      footer={
        <>
          <DialogButton onClick={onClose}>{knowledgeT('cancel')}</DialogButton>
          <DialogButton
            variant="primary"
            disabled={!changed || busy}
            onClick={() => onConfirm(access)}
          >
            {busy ? knowledgeT('applying') : knowledgeT('confirmChange')}
          </DialogButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <AccessOptions value={access} onChange={setAccess} disabled={busy} />
        {changed ? (
          <p className="flex gap-2 rounded-[8px] border border-[var(--warn-soft-line)] bg-[var(--warn-soft)] px-3 py-2.5 text-[10.5px] leading-relaxed text-[var(--warn-ink)]">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            {defaultAccessRebuildNotice(locale)}
          </p>
        ) : (
          <p className="text-[10.5px] text-[var(--muted)]">
            {knowledgeT('chooseConfirmChangeToApplyNoUpdateIs')}
          </p>
        )}
      </div>
    </ModalDialog>
  );
}

function RenameTeamspaceDialog({
  teamspace,
  busy,
  onClose,
  onSubmit,
}: {
  teamspace: TeamspaceRow | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [name, setName] = useState(teamspace?.name ?? '');
  const [touched, setTouched] = useState(false);
  const validation = validateOrganizationName(name);
  const initial = teamspace?.name ?? '';
  function close() {
    onClose();
    setName(initial);
    setTouched(false);
  }
  return (
    <ModalDialog
      open={teamspace !== null}
      onClose={close}
      title={knowledgeT('renameFolder')}
      footer={
        <>
          <DialogButton onClick={close}>{knowledgeT('cancel')}</DialogButton>
          <DialogButton
            variant="primary"
            disabled={!validation.ok || validation.value === initial || busy}
            onClick={() => {
              setTouched(true);
              if (validation.ok) onSubmit(validation.value);
            }}
          >
            {busy ? knowledgeT('saving') : knowledgeT('save')}
          </DialogButton>
        </>
      }
    >
      <NameField
        label={knowledgeT('name')}
        value={name}
        onChange={(value) => {
          setName(value);
          setTouched(true);
        }}
        placeholder={knowledgeT('enterANewName')}
        autoFocus
        invalidReason={touched && !validation.ok ? validation.reason : undefined}
      />
    </ModalDialog>
  );
}
