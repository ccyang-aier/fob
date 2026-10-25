import { createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './index.messages';
import { CheckSquare } from '@/components/icons';
import { setBlockFormat } from '../../extensions/format/block-format';
import type { EditorBlockModule } from '../types';
import { TaskListInputRule } from './input-rule';
import { TaskItemToggle } from './task-item-toggle';
import './task-list.css';

export function TaskListModule(locale?: Locale): EditorBlockModule {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    name: 'taskList',
    icon: CheckSquare,
    extensions: [TaskListInputRule, TaskItemToggle],
    title: knowledgeT('taskList'),
    shortcut: '⌃ ⇧ 7',
    insert: (editor) =>
      editor
        .chain()
        .command(setBlockFormat({ kind: 'taskList' }))
        .run(),
  };
}
