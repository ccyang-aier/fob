'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './comment-editor.messages';
import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { Extension, markInputRule, wrappingInputRule } from '@tiptap/core';
import {
  EditorContent,
  useEditor,
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
} from '@tiptap/react';
import { splitListItem, liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import { undo, redo, history } from '@tiptap/pm/history';
import { Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { createMarkdownPipeline } from '@fob/shared/knowledge/markdown';
import { CommentImage } from './comment-markdown';
import { useEditorLocale } from '../../editor/use-editor-locale';
import styles from './comments.module.css';

const markdown = createMarkdownPipeline();
const supported = new Set([
  'doc',
  'text',
  'hardBreak',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'image',
  'bold',
  'italic',
  'strike',
  'code',
  'link',
]);

/** Empty top-level paragraphs are editing space, not comment content. */
export function serializeCommentDocument(document: ProseMirrorNode): string {
  const content: ReturnType<ProseMirrorNode['toJSON']>[] = [];
  document.forEach((node) => {
    if (node.type.name !== 'paragraph' || node.content.size > 0) content.push(node.toJSON());
  });
  return content.length
    ? markdown.serialize(markdown.schema.nodeFromJSON({ type: 'doc', content })).trim()
    : '';
}

export const CommentEditing = Extension.create({
  name: 'commentEditing',
  addProseMirrorPlugins: () => [history()],
  addInputRules() {
    const { marks, nodes } = this.editor.schema;
    return [
      markInputRule({ find: /\*\*([^*]+)\*\*$/, type: marks.bold }),
      markInputRule({ find: /__([^_]+)__$/, type: marks.bold }),
      markInputRule({ find: /(?:^|[^*])\*([^*]+)\*$/, type: marks.italic }),
      markInputRule({ find: /(?:^|[^_])_([^_]+)_$/, type: marks.italic }),
      markInputRule({ find: /`([^`]+)`$/, type: marks.code }),
      wrappingInputRule({ find: /^\s*([-*+])\s$/, type: nodes.bulletList }),
      wrappingInputRule({
        find: /^\s*(\d+)\.\s$/,
        type: nodes.orderedList,
        getAttributes: (match) => ({ start: Number(match[1]) }),
      }),
    ];
  },
  addKeyboardShortcuts() {
    return {
      Enter: () =>
        splitListItem(this.editor.schema.nodes.listItem)(
          this.editor.state,
          this.editor.view.dispatch,
        ) ||
        liftListItem(this.editor.schema.nodes.listItem)(
          this.editor.state,
          this.editor.view.dispatch,
        ),
      Tab: () =>
        sinkListItem(this.editor.schema.nodes.listItem)(
          this.editor.state,
          this.editor.view.dispatch,
        ),
      'Shift-Tab': () =>
        liftListItem(this.editor.schema.nodes.listItem)(
          this.editor.state,
          this.editor.view.dispatch,
        ),
      'Mod-z': () => undo(this.editor.state, this.editor.view.dispatch),
      'Mod-Shift-z': () => redo(this.editor.state, this.editor.view.dispatch),
      'Mod-b': () => this.editor.commands.toggleMark('bold'),
      'Mod-i': () => this.editor.commands.toggleMark('italic'),
    };
  },
});

export function commentEditorExtensions(knowledgeBaseId: string) {
  return [
    ...createKnowledgeExtensions()
      .filter((extension) => supported.has(extension.name))
      .map((extension) =>
        extension.name === 'image'
          ? extension.extend({
              addNodeView: () =>
                ReactNodeViewRenderer((props: NodeViewProps) => (
                  <NodeViewWrapper>
                    <CommentImage
                      source={String(props.node.attrs.src)}
                      alt={String(props.node.attrs.alt || '')}
                      knowledgeBaseId={knowledgeBaseId}
                    />
                  </NodeViewWrapper>
                )),
            })
          : extension.name === 'codeBlock'
            ? extension.extend({ marks: '' })
            : extension,
      ),
    CommentEditing,
  ];
}

export interface CommentEditorHandle {
  focus: () => void;
  clear: () => void;
  insertText: (text: string) => void;
  insertLink: (href: string) => void;
  insertImage: (hash: string, name: string) => void;
}

export function CommentEditor({
  ref,
  knowledgeBaseId,
  initialBody,
  placeholder,
  disabled,
  autoFocus,
  focusKey,
  minHeight,
  onChange,
  onSubmit,
  onCancel,
}: {
  ref: Ref<CommentEditorHandle>;
  knowledgeBaseId: string;
  initialBody: string;
  placeholder: string;
  disabled: boolean;
  autoFocus: boolean;
  focusKey?: string;
  minHeight: number;
  onChange: (body: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const extensions = useMemo(() => commentEditorExtensions(knowledgeBaseId), [knowledgeBaseId]);
  const content = useMemo(() => markdown.parse(initialBody).toJSON(), [initialBody]);
  const callbacks = useRef({ onChange, onSubmit, onCancel, disabled });
  useEffect(() => {
    callbacks.current = { onChange, onSubmit, onCancel, disabled };
  }, [onChange, onSubmit, onCancel, disabled]);
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions,
      content,
      editable: !disabled,
      onUpdate: ({ editor }) =>
        callbacks.current.onChange(serializeCommentDocument(editor.state.doc)),
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-label': placeholder,
          'aria-multiline': 'true',
          'data-placeholder': placeholder,
          class: styles.richInput,
          style: `min-height:${minHeight}px`,
        },
        handleKeyDown: (_view, event) => {
          if (event.isComposing) return false;
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            callbacks.current.onSubmit();
            return true;
          }
          if (event.key === 'Escape' && callbacks.current.onCancel && !callbacks.current.disabled) {
            event.preventDefault();
            callbacks.current.onCancel();
            return true;
          }
          return false;
        },
        handlePaste: (view, event) => {
          const text = event.clipboardData?.getData('text/plain');
          if (!text || event.clipboardData?.getData('text/html')) return false;
          const doc = view.state.schema.nodeFromJSON(markdown.parse(text).toJSON());
          event.preventDefault();
          view.dispatch(
            view.state.tr.replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView(),
          );
          return true;
        },
      },
    },
    [knowledgeBaseId],
  );
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  useEditorLocale(editor, locale, placeholder, placeholder);
  useEffect(() => {
    if (autoFocus) editor?.commands.focus('end');
  }, [editor, autoFocus, focusKey]);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editor?.commands.focus();
      },
      clear: () => {
        editor?.commands.clearContent();
      },
      insertText: (text) => {
        editor?.chain().focus().insertContent({ type: 'text', text }).run();
      },
      insertLink: (href) => {
        if (editor) {
          const label =
            editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to) ||
            knowledgeT('linkText');
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'text',
              text: label,
              marks: [{ type: 'link', attrs: { href } }],
            })
            .run();
        }
      },
      insertImage: (hash, name) => {
        editor
          ?.chain()
          .focus()
          .insertContent([
            { type: 'image', attrs: { src: `asset:${hash}`, alt: name } },
            { type: 'paragraph' },
          ])
          .run();
      },
    }),
    [editor, knowledgeT],
  );
  return <EditorContent editor={editor} />;
}
