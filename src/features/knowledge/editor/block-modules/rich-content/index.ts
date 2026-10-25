import { createElement } from 'react';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ChartBar, FilePdf, LinkSimple, Palette } from '@/components/icons';
import { withNodeView } from '../../extensions/with-node-view';
import { insertAtom } from '../insert';
import type { EditorBlockModule } from '../types';
import { LinkCardNodeView } from './link-card-node-view';
import { MermaidNodeView } from './mermaid-node-view';
import { PdfNodeView } from './pdf-node-view';
import { WhiteboardNodeView } from './whiteboard-node-view';

export const RichContentModules: readonly EditorBlockModule[] = [
  { name: 'linkCard', icon: LinkSimple, insert: insertAtom('linkCard'), decorate: (extensions, context) => withNodeView(extensions, 'linkCard', () => ReactNodeViewRenderer(props => createElement(LinkCardNodeView, { ...props, context }))) },
  { name: 'mermaid', icon: ChartBar, insert: insertAtom('mermaid'), decorate: extensions => withNodeView(extensions, 'mermaid', () => ReactNodeViewRenderer(MermaidNodeView)) },
  { name: 'pdf', icon: FilePdf, insert: insertAtom('pdf'), decorate: (extensions, context) => withNodeView(extensions, 'pdf', () => ReactNodeViewRenderer(props => createElement(PdfNodeView, { ...props, context }))) },
  { name: 'whiteboard', icon: Palette, insert: insertAtom('whiteboard'), decorate: extensions => withNodeView(extensions, 'whiteboard', () => ReactNodeViewRenderer(WhiteboardNodeView)) },
];
