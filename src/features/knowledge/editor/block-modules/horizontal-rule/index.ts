import { Minus } from '@phosphor-icons/react';
import { insertAtom } from '../insert';
import type { EditorBlockModule } from '../types';
import { DividerInputRule } from './input-rule';

export const HorizontalRuleModule: EditorBlockModule = { name: 'horizontalRule', icon: Minus, insert: insertAtom('horizontalRule'), extensions: [DividerInputRule] };
