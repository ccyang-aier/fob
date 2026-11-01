'use client';

import { createContext, useContext, useEffect, useRef, useState, type DragEvent, type HTMLAttributes, type ReactNode } from 'react';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { resolveTreeDrop, type TreeDocument, type TreeDragItem, type TreeFolder, type TreeMove } from './tree-drop-policy';
import { messages } from './tree-drag.messages';
import styles from './tree-drag.module.css';

const dragType = 'application/x-fob-navigation';
type Target = { folderId: string | null };
type DragContext = {
  active: TreeDragItem | null; target: Target | null; busy: boolean;
  canDrag(item: TreeDragItem): boolean;
  start(event: DragEvent<HTMLDivElement>, item: TreeDragItem): void;
  end(): void;
  over(event: DragEvent<HTMLDivElement>, target: Target): void;
  leave(event: DragEvent<HTMLDivElement>): void;
  drop(event: DragEvent<HTMLDivElement>, target: Target): void;
  valid(target: Target): boolean;
  hint: string; invalid: boolean;
};
const Context = createContext<DragContext | null>(null);

export function TreeDragProvider({ folders, documents, canMoveFolders, canMoveDocuments, onMove, onExpandFolder, errorText, children }: {
  folders: readonly TreeFolder[]; documents: readonly TreeDocument[]; canMoveFolders: boolean; canMoveDocuments: boolean;
  onMove(move: TreeMove): Promise<void> | void; onExpandFolder(id: string): void; errorText(error: unknown): string; children: ReactNode;
}) {
  const { t } = useTranslation(messages), { notify } = useAppAlert();
  const [active, setActive] = useState<TreeDragItem | null>(null), [target, setTarget] = useState<Target | null>(null), [busy, setBusy] = useState(false);
  const pending = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const hoveredFolder = target?.folderId;
  useEffect(() => {
    if (!active || !hoveredFolder || !resolveTreeDrop(folders, documents, active, hoveredFolder).ok) return;
    const timer = setTimeout(() => onExpandFolder(hoveredFolder), 600);
    return () => clearTimeout(timer);
  }, [active, hoveredFolder, folders, documents, onExpandFolder]);
  const canDrag = (item: TreeDragItem) => !busy && (item.kind === 'folder' ? canMoveFolders : canMoveDocuments);
  const valid = (destination: Target) => Boolean(active && canDrag(active) && resolveTreeDrop(folders, documents, active, destination.folderId).ok);
  const internal = (event: DragEvent<HTMLDivElement>) => active && event.dataTransfer.types.includes(dragType);
  const result = active && target ? resolveTreeDrop(folders, documents, active, target.folderId) : null;
  const invalid = result !== null && !result.ok;
  const hint = result && !result.ok ? t(result.reason) : t(active?.kind === 'document' ? 'documentHint' : 'root');
  function end() { setActive(null); setTarget(null); }
  return <Context.Provider value={{ active, target, busy, canDrag, valid, hint, invalid,
    start(event, item) {
      if (pending.current || !canDrag(item)) { event.preventDefault(); return; }
      event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(dragType, JSON.stringify(item));
      setActive(item); setTarget(null);
    },
    end,
    over(event, destination) {
      if (!internal(event)) return;
      event.stopPropagation(); event.preventDefault(); event.dataTransfer.dropEffect = valid(destination) ? 'move' : 'none';
      setTarget(current => current?.folderId === destination.folderId ? current : destination);
    },
    leave(event) {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setTarget(null);
    },
    drop(event, destination) {
      if (!internal(event)) return;
      event.stopPropagation(); event.preventDefault();
      const outcome = active && canDrag(active) ? resolveTreeDrop(folders, documents, active, destination.folderId) : null;
      end();
      if (!outcome?.ok || pending.current) return;
      pending.current = true; setBusy(true);
      void (async () => {
        try { await onMove(outcome.move); if (mounted.current) { if (destination.folderId) onExpandFolder(destination.folderId); notify('success', t('moved')); } }
        catch (error) { if (mounted.current) notify('error', errorText(error)); }
        finally { pending.current = false; if (mounted.current) setBusy(false); }
      })();
    },
  }}>{children}</Context.Provider>;
}

export function TreeDragRow({ item, className = '', children, ...props }: HTMLAttributes<HTMLDivElement> & { item: TreeDragItem }) {
  const drag = useContext(Context), { t } = useTranslation(messages), ignore = useRef(false);
  const isFolder = item.kind === 'folder', target = { folderId: item.id };
  const draggable = Boolean(drag?.canDrag(item));
  return <div {...props} className={`${styles.row} ${className}`} data-tree-kind={item.kind} data-tree-id={item.id} data-tree-draggable={draggable || undefined} data-tree-dragging={drag?.active?.kind === item.kind && drag.active.id === item.id || undefined}
    data-tree-drop={isFolder && drag?.target?.folderId === item.id && drag.valid(target) || undefined}
    draggable={draggable} aria-description={draggable ? t(isFolder ? 'folderDrag' : 'documentDrag') : undefined}
    onPointerDownCapture={event => { ignore.current = event.target instanceof Element && Boolean(event.target.closest('[data-tree-drag-control], input, form, button[aria-expanded], button[aria-haspopup]')); }}
    onDragStart={event => { if (ignore.current) event.preventDefault(); else drag?.start(event, item); }} onDragEnd={() => drag?.end()}
    onDragEnter={isFolder ? event => drag?.over(event, target) : undefined} onDragOver={isFolder ? event => drag?.over(event, target) : undefined} onDragLeave={isFolder ? event => drag?.leave(event) : undefined} onDrop={isFolder ? event => drag?.drop(event, target) : undefined}>
    {children}
  </div>;
}

/** Covers the existing section heading while dragging, without shifting row positions. */
export function TreeRootDropTarget({ children }: { children: ReactNode }) {
  const drag = useContext(Context), target = { folderId: null };
  return <div className={styles.root} data-tree-root data-tree-drag-active={Boolean(drag?.active)} data-tree-drop={drag?.target?.folderId === null && drag.valid(target) || undefined}
    onDragEnter={event => drag?.over(event, target)} onDragOver={event => drag?.over(event, target)} onDragLeave={event => drag?.leave(event)} onDrop={event => drag?.drop(event, target)}>
    <div className={styles.header}>{children}</div>
    {drag?.active && <div role="status" className={styles.hint} data-invalid={drag.invalid || undefined}>{drag.hint}</div>}
  </div>;
}
