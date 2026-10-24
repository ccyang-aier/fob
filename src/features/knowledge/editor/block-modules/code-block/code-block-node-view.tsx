'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './code-block-node-view.messages';
import { useEffect, useRef, useState, type FC } from 'react';
import { CaretDown, Check, Copy, DotsThree } from '@phosphor-icons/react';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CODE_LANGUAGES, detectedCodeLanguage } from './highlight';
import './code-themes.css';
import styles from './code-block.module.css';

const CodeContent = NodeViewContent as unknown as FC<{ as: 'pre'; className?: string }>;
const THEMES = [
  { id: 'light', label: 'GitHub Light' },
  { id: 'dark', label: 'GitHub Dark' },
  { id: 'monokai', label: 'Monokai' },
  { id: 'idea', label: 'IntelliJ Light' },
  { id: 'darcula', label: 'Darcula' },
  { id: 'one-dark', label: 'One Dark' },
  { id: 'nord', label: 'Nord' },
  { id: 'paper', label: 'Stack Overflow Light' },
] as const;

export function CodeBlockNodeView({
  node,
  editor,
  updateAttributes,
  HTMLAttributes,
}: NodeViewProps) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = String(node.attrs.language || 'auto');
  const detected = language === 'auto' ? detectedCodeLanguage(node.textContent) : null;
  const lines = Math.max(1, node.textContent.split('\n').length);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <NodeViewWrapper
      as="div"
      {...HTMLAttributes}
      data-fob-node="code-block"
      data-block-id={node.attrs.blockId}
      data-code-theme={node.attrs.theme}
      data-code-wrap={String(node.attrs.wrap)}
      className={styles.root + ' fob-code-theme'}
    >
      <div className={styles.header} contentEditable={false}>
        <div className={styles.languageRow}>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              className={styles.languageSelect}
              aria-label={knowledgeT('codeLanguage')}
              data-document-export-text
              disabled={!editor.isEditable}
            >
              {CODE_LANGUAGES(locale).find((item) => item.value === language)?.label ?? language}
              <CaretDown size={12} aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent className={styles.languageMenu} align="start">
              <ScrollArea className={styles.languageScroll}>
                {CODE_LANGUAGES(locale).map((item) => (
                  <DropdownMenuItem
                    key={item.value}
                    onSelect={() =>
                      updateAttributes({ language: item.value === 'auto' ? null : item.value })
                    }
                  >
                    {item.label}
                    {language === item.value && <Check className="ml-auto" aria-hidden />}
                  </DropdownMenuItem>
                ))}
              </ScrollArea>
            </DropdownMenuContent>
          </DropdownMenu>
          {detected && (
            <span className={styles.detected}>
              {CODE_LANGUAGES(locale).find((item) => item.value === detected)?.label ?? detected}
            </span>
          )}
        </div>
        <div className={styles.actions} data-document-export-omit>
          <button
            type="button"
            className={styles.iconButton}
            onClick={copy}
            aria-label={copied ? knowledgeT('codeCopied') : knowledgeT('copyCode')}
          >
            {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
          </button>
          {editor.isEditable && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                className={styles.iconButton}
                aria-label={knowledgeT('codeBlockDisplaySettings')}
              >
                <DotsThree size={20} weight="bold" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent className={styles.menu} align="end">
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className={styles.setting}>
                    {knowledgeT('appearance')}
                    <span
                      className={styles.themeValue}
                      title={THEMES.find((theme) => theme.id === node.attrs.theme)?.label}
                    >
                      {THEMES.find((theme) => theme.id === node.attrs.theme)?.label}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className={styles.themeMenu} collisionPadding={8}>
                    <DropdownMenuRadioGroup
                      value={String(node.attrs.theme)}
                      onValueChange={(theme) => updateAttributes({ theme })}
                    >
                      {THEMES.map((theme) => (
                        <DropdownMenuRadioItem key={theme.id} value={theme.id}>
                          {theme.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  className={styles.setting}
                  checked={Boolean(node.attrs.lineNumbers)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(lineNumbers) => updateAttributes({ lineNumbers })}
                >
                  {knowledgeT('showLineNumbers')}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  className={styles.setting}
                  checked={Boolean(node.attrs.wrap)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(wrap) => updateAttributes({ wrap })}
                >
                  {knowledgeT('wrapLines')}
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <div className={styles.body}>
        {node.attrs.lineNumbers && (
          <div className={styles.gutter} contentEditable={false} aria-hidden>
            {Array.from({ length: lines }, (_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
        )}
        <CodeContent as="pre" className={styles.code} />
      </div>
    </NodeViewWrapper>
  );
}
