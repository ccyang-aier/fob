import { KnowledgeLibrary, UsersThree, SquaresFour } from '@/components/icons';
import type { WorkbenchView } from './workbench-view';

export type WorkbenchPage = Exclude<WorkbenchView, 'settings'>;
export const workbenchPages = {
  members: { label: '成员', icon: UsersThree },
  knowledge: { label: '知识库', icon: KnowledgeLibrary },
  templates: { label: '模板', icon: SquaresFour },
} as const;
