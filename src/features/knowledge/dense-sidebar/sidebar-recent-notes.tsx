"use client";

import * as React from "react";

import type { DocumentAction } from "@/features/knowledge/dense-sidebar/document-action-menu-content";
import { RecentNoteRow } from "@/features/knowledge/dense-sidebar/sidebar-navigation-primitives";
import type { SidebarRecentNote } from "@/features/knowledge/dense-sidebar/sidebar-navigation";
import { useI18n } from "@/features/knowledge/dense-sidebar/use-i18n";

const bottomFadeMask =
  "linear-gradient(to bottom, #000 0, #000 calc(100% - 17px), rgba(0,0,0,.72) calc(100% - 8px), rgba(0,0,0,.38) 100%)";

export function SidebarRecentNotes({
  notes,
  activeRecentId,
  onSelectRecent,
  onDocumentAction,
}: {
  notes: SidebarRecentNote[];
  activeRecentId: string | null;
  onSelectRecent: (id: string) => void;
  onDocumentAction: (id: string, action: DocumentAction) => void;
}) {
  const { t } = useI18n();
  const listRef = React.useRef<HTMLElement>(null);
  const [fadesAtBottom, setFadesAtBottom] = React.useState(false);

  const updateFade = React.useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    setFadesAtBottom(list.scrollHeight - list.scrollTop - list.clientHeight > 2);
  }, []);

  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const frame = window.requestAnimationFrame(updateFade);
    const delayedCheck = window.setTimeout(updateFade, 240);
    const resizeObserver = new ResizeObserver(updateFade);
    resizeObserver.observe(list);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(delayedCheck);
      resizeObserver.disconnect();
    };
  }, [notes, updateFade]);

  return (
    <nav
      ref={listRef}
      onScroll={updateFade}
      className="h-full min-h-0 space-y-0.5 overflow-y-auto pr-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={
        fadesAtBottom
          ? { maskImage: bottomFadeMask, WebkitMaskImage: bottomFadeMask }
          : undefined
      }
    >
      {notes.map((note) => (
        <RecentNoteRow
          key={note.id}
          documentId={note.id}
          icon={note.icon}
          label={note.label ?? (note.labelKey ? t(note.labelKey) : "")}
          starred={note.starred}
          selected={activeRecentId === note.id}
          onClick={() => onSelectRecent(note.id)}
          onAction={onDocumentAction}
        />
      ))}
    </nav>
  );
}
