import { Smiley } from '@/components/icons';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { insertAtom } from '../insert';
import type { EditorBlockModule } from '../types';
import { EmojiNodeView } from './emoji-node-view';

export const EmojiModule: EditorBlockModule = {
  name: 'emoji', icon: Smiley, insert: insertAtom('emoji'),
  decorate: extensions => withNodeView(extensions, 'emoji', () => ReactNodeViewRenderer(EmojiNodeView)),
};
