import { createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './index.messages';
import { TextHOne } from '@/components/icons';
import { setBlockFormat } from '../../extensions/format/block-format';
import type { EditorBlockModule } from '../types';
import { HeadingInputRule } from './input-rule';
import { HeadingAffordance } from './heading-affordance';

const heading = (level: 1 | 2 | 3 | 4) => (editor: Parameters<EditorBlockModule['insert']>[0]) =>
  editor
    .chain()
    .command(setBlockFormat({ kind: 'heading', level }))
    .run();

export function HeadingModule(locale?: Locale): EditorBlockModule {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    name: 'heading',
    icon: TextHOne,
    insert: heading(2),
    extensions: [HeadingInputRule, HeadingAffordance],
    choices: ([1, 2, 3, 4] as const).map((level) => ({
      name: level === 2 ? 'heading' : `heading${level}`,
      title: [
        knowledgeT('heading1'),
        knowledgeT('heading2'),
        knowledgeT('heading3'),
        knowledgeT('heading4'),
      ][level - 1],
      marker: `H${level}`,
      shortcut: `⌃ ⇧ ${level}`,
      keywords: [`h${level}`],
      insert: heading(level),
    })),
  };
}
