'use client';

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import type { Editor, EditorEvents } from '@tiptap/react';
import type { Transaction } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { yUndoPluginKey } from 'y-prosemirror';
import { BLOCK_EDITS_MAP, blockEditFingerprint, documentBlockContent, readBlockEdit } from '@fob/shared/knowledge/collaboration';
import { ArrowLeft, ArrowsClockwise, CaretRight, Code, Info, LinkSimple, ListBullets, ListChecks, ListNumbers, Plus, Quotes, SelectionCheck, TextHOne, TextHTwo, TextHThree, TextHFour, TextT, Trash } from '@/components/icons';
import { useAppAlert } from '@/components/app-alert-provider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/lib/i18n';
import { useBlockMenuContext } from '../../block-menu-context';
import { documentBlockLink } from '../../document-link';
import { convertMenuBlock, deleteMenuBlock, insertBelowMenuBlock, menuBlockFormat, resolveMenuBlock, type MenuBlock } from '../../extensions/block-menu';
import { openBlockInsertMenu } from '../../commands/slash-paste';
import { blockDragMessages } from './messages';
import styles from './styles.module.css';

const formats = [
  { key: 'paragraph', format: { kind: 'paragraph' }, icon: TextT },
  { key: 'heading1', format: { kind: 'heading', level: 1 }, icon: TextHOne },
  { key: 'heading2', format: { kind: 'heading', level: 2 }, icon: TextHTwo },
  { key: 'heading3', format: { kind: 'heading', level: 3 }, icon: TextHThree },
  { key: 'heading4', format: { kind: 'heading', level: 4 }, icon: TextHFour },
  { key: 'bulletList', format: { kind: 'bulletList' }, icon: ListBullets },
  { key: 'orderedList', format: { kind: 'orderedList' }, icon: ListNumbers },
  { key: 'taskList', format: { kind: 'taskList' }, icon: ListChecks },
  { key: 'blockquote', format: { kind: 'blockquote' }, icon: Quotes },
  { key: 'callout', format: { kind: 'callout' }, icon: Info },
  { key: 'codeBlock', format: { kind: 'codeBlock' }, icon: Code },
] as const;

const narrowQuery = '(max-width: 600px)';
function subscribeViewport(listener: () => void) {
  const query = window.matchMedia(narrowQuery);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
const narrowViewport = () => window.matchMedia(narrowQuery).matches;
const serverViewport = () => false;

/** Radix uses a passive anchor so pointer-down stays available for native dragging. */
export function BlockMenu({ id, editor, target, anchor, handle, onClose }: {
  id: string; editor: Editor; target: MenuBlock | null; anchor: RefObject<HTMLSpanElement | null>; handle: RefObject<HTMLButtonElement | null>; onClose: () => void;
}) {
  const { t, locale } = useTranslation(blockDragMessages);
  const context = useBlockMenuContext();
  const { notify } = useAppAlert();
  const [, refresh] = useState(0);
  const narrow = useSyncExternalStore(subscribeViewport, narrowViewport, serverViewport);
  const [conversionFor, setConversionFor] = useState<MenuBlock | null>(null);
  const showFormats = narrow && Boolean(target) && conversionFor === target;
  useEffect(() => {
    if (!target) return;
    const update = () => {
      if (!editor.isEditable || resolveMenuBlock(editor.state, target) === null) onClose();
      else refresh(value => value + 1);
    };
    const transaction = ({ transaction }: EditorEvents['transaction']) => { if (transaction.docChanged || !editor.isEditable) update(); };
    editor.on('transaction', transaction);
    const map = context?.document?.getMap(BLOCK_EDITS_MAP);
    map?.observe(update);
    return () => { editor.off('transaction', transaction); map?.unobserve(update); };
  }, [editor, target, context?.document, onClose]);
  const pos = target ? resolveMenuBlock(editor.state, target) : null;
  const node = pos === null ? null : editor.state.doc.nodeAt(pos);
  const active = node && pos !== null ? menuBlockFormat(node, editor.state.doc.resolve(pos).parent) : null;
  const record = target ? readBlockEdit(context?.document?.getMap(BLOCK_EDITS_MAP).get(target.blockId) ?? context?.entries?.[target.blockId]) : null;
  const currentContent = record && node && target ? context?.document ? documentBlockContent(context.document, target.blockId) : JSON.stringify(node.toJSON()) : null;
  const edit = record && currentContent && record.fingerprint === blockEditFingerprint(currentContent) ? record : null;
  const act = (transaction: Transaction | null, insert = false) => {
    if (!editor.isEditable || !transaction) { notify('error', t('actionFailed')); onClose(); return; }
    onClose();
    const manager = yUndoPluginKey.getState(editor.state)?.undoManager;
    manager?.stopCapturing();
    editor.view.dispatch(closeHistory(transaction));
    manager?.stopCapturing();
    editor.view.focus();
    if (insert) openBlockInsertMenu(editor.view, editor.state.selection.$from.before());
  };
  const copyLink = async () => {
    if (!target || !context || resolveMenuBlock(editor.state, target) === null) { notify('error', t('actionFailed')); return; }
    const link = documentBlockLink(window.location.href, context.target, target.blockId);
    try { await navigator.clipboard.writeText(link); notify('success', t('linkCopied')); }
    catch { notify('error', t('copyFailed')); }
  };
  const convertible = target && formats.some(({ format }) => convertMenuBlock(editor.state, target, format) !== null);
  const formatItems = target && formats.map(({ key, format, icon: Icon }) => {
    const selected = active?.kind === format.kind && (format.kind !== 'heading' || active.kind === 'heading' && active.level === format.level);
    const available = convertMenuBlock(editor.state, target, format) !== null;
    return <DropdownMenuItem key={key} className={styles.menuItem} disabled={!available} title={!available ? t('conversionUnavailable') : undefined}
      onSelect={() => act(convertMenuBlock(editor.state, target, format))}>
      <Icon size={14} /><span>{t(key)}</span>{selected && <SelectionCheck className={styles.selected} />}
    </DropdownMenuItem>;
  });
  return <DropdownMenu modal={false} open={Boolean(target)} onOpenChange={open => { if (!open) onClose(); }}>
    <DropdownMenuTrigger asChild><span ref={anchor} className={styles.anchor} aria-hidden tabIndex={-1} /></DropdownMenuTrigger>
    {target && <DropdownMenuContent id={id} aria-label={showFormats ? t('convertTo') : t('blockMenu')} className={styles.menu} data-block-menu side="left" align="start" sideOffset={6}
      collisionPadding={8} onCloseAutoFocus={event => event.preventDefault()}
      onInteractOutside={event => { if (handle.current?.contains(event.target as Node)) event.preventDefault(); }}
      onEscapeKeyDown={event => { if (showFormats) { event.preventDefault(); setConversionFor(null); } else handle.current?.focus({ preventScroll: true }); }}>
      {showFormats ? <>
        <DropdownMenuItem className={styles.menuItem} onSelect={event => { event.preventDefault(); setConversionFor(null); }}><ArrowLeft size={14} />{t('backToBlockMenu')}</DropdownMenuItem>
        <DropdownMenuSeparator className={styles.separator} />
        {formatItems}
      </> : <>
      {narrow ? <DropdownMenuItem className={styles.menuItem} disabled={!convertible} title={!convertible ? t('conversionUnavailable') : undefined}
        onSelect={event => { event.preventDefault(); setConversionFor(target); }}
        onKeyDown={event => { if (event.key === 'ArrowRight') { event.preventDefault(); setConversionFor(target); } }}>
        <ArrowsClockwise size={14} />{t('convertTo')}<CaretRight className={styles.selected} />
      </DropdownMenuItem> : <DropdownMenuSub>
        <DropdownMenuSubTrigger className={styles.menuItem} disabled={!convertible} title={!convertible ? t('conversionUnavailable') : undefined}><ArrowsClockwise size={14} />{t('convertTo')}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className={`${styles.menu} ${styles.submenu}`} collisionPadding={8}>
          {formatItems}
        </DropdownMenuSubContent>
      </DropdownMenuSub>}
      <DropdownMenuItem className={styles.menuItem} onSelect={() => act(insertBelowMenuBlock(editor.state, target), true)}><Plus size={14} />{t('insertBelow')}</DropdownMenuItem>
      <DropdownMenuItem className={styles.menuItem} disabled={!context} title={!context ? t('linkUnavailable') : undefined} onSelect={() => { void copyLink(); }}><LinkSimple size={14} />{t('copyLink')}</DropdownMenuItem>
      <DropdownMenuSeparator className={styles.separator} />
      <DropdownMenuItem className={styles.menuItem} variant="destructive" onSelect={() => act(deleteMenuBlock(editor.state, target))}><Trash size={14} />{t('deleteBlock')}</DropdownMenuItem>
      <DropdownMenuSeparator className={styles.separator} />
      <div className={styles.metadata}>{edit ? <><span>{t('lastEditedBy', { name: edit.actorId === 'local' ? t('you') : edit.actorName ?? t('unknownEditor') })}</span><time dateTime={edit.editedAt}>{new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(edit.editedAt))}</time></> : <span>{t('noEditRecord')}</span>}</div>
      </>}
    </DropdownMenuContent>}
  </DropdownMenu>;
}
