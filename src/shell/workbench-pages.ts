import { BookOpenText, UsersThree } from '@phosphor-icons/react';
import type { WorkbenchView } from './workbench-view';

export type WorkbenchPage = Exclude<WorkbenchView, 'settings'>;
export const workbenchPages = {
  members: { label: '成员', icon: UsersThree },
  knowledge: { label: '知识库', icon: BookOpenText },
} as const;
