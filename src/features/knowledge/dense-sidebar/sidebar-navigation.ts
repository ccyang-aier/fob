// Dense sidebar navigation model, narrowed to the knowledge surface in Fob.
import type { sidebarMessages } from './messages';
export type SidebarMessageKey = keyof typeof sidebarMessages;
export type SidebarIconName =
  | 'home'
  | 'star'
  | 'archive'
  | 'trash'
  | 'hash'
  | 'calendar'
  | 'sprout'
  | 'image'
  | 'file'
  | 'folder'
  | 'tasks'
  | 'blocks';
export interface SidebarNavigationItem {
  id: string;
  labelKey: SidebarMessageKey;
  icon: SidebarIconName;
  tone?: 'teal' | 'amber' | 'indigo' | 'rose';
  count?: number;
}
import type { ProjectIconId } from './project-icons';
export interface SidebarProjectNode {
  id: string;
  kind?: 'project' | 'document';
  label?: string;
  labelKey?: SidebarMessageKey;
  projectIconId?: ProjectIconId;
  icon?: SidebarIconName;
  documentIcon?: string | null;
  expandable?: boolean;
  defaultExpanded?: boolean;
  starred?: boolean;
  count?: number;
  children?: SidebarProjectNode[];
}
export interface SidebarRecentNote {
  id: string;
  icon?: string | null;
  label?: string;
  labelKey?: SidebarMessageKey;
  starred?: boolean;
}
export const SIDEBAR_MAIN_ITEMS: SidebarNavigationItem[] = [
  { id: 'all-documents', labelKey: 'sidebar.home', icon: 'home', tone: 'teal' },
  { id: 'starred', labelKey: 'sidebar.starred', icon: 'star', tone: 'amber' },
  { id: 'drafts', labelKey: 'sidebar.drafts', icon: 'file', tone: 'indigo' },
  { id: 'trash', labelKey: 'sidebar.trash', icon: 'trash', tone: 'rose' },
];

export type TagSummary = { id: string; name: string; color: string };
export type SidebarDocumentSummary = {
  id: string;
  icon?: string | null;
  title: string;
  starred: boolean;
};
