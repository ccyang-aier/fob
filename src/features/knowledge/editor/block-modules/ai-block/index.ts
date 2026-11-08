import { GenerateStar, ShapesOutline } from '@/components/icons';
import { insertBuiltNodes } from '../insert';
import type { EditorBlockModule } from '../types';
import { createElement } from 'react';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { AiBlockNodeView } from './ai-block-node-view';
import { translate } from '@/lib/i18n';
import { knowledgeMessages } from './ai-block-node-view.messages';

export const AiBlockModule: EditorBlockModule = {
  name: 'aiBlock', icon: GenerateStar,
  insert: insertBuiltNodes((nodes) => [nodes.aiBlock.create(null, [nodes.paragraph.create()])]),
  choices: [
    { name: 'aiBlock', title: '生成', keywords: ['generate', '生成', 'ai', '智能'], icon: GenerateStar, insert: insertBuiltNodes(nodes => [nodes.aiBlock.create(null, [nodes.paragraph.create()])]) },
    { name: 'aiVisualization', title: '创建可视化', keywords: ['visualize', 'chart', '可视化', '图表', 'ai'], icon: ShapesOutline, insert: editor => insertBuiltNodes(nodes => [nodes.aiBlock.create({ prompt: translate(knowledgeMessages, 'visualizationPrompt') }, [nodes.paragraph.create()])])(editor) },
  ],
  decorate: (extensions, context) => withNodeView(extensions, 'aiBlock', () => ReactNodeViewRenderer((props) => createElement(AiBlockNodeView, { ...props, scope: context.scope, userId: context.cacheIdentity }))),
};
