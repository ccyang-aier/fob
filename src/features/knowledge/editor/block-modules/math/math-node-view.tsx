'use client';

import { useTranslation, createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './math-node-view.messages';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Function as FunctionIcon } from '@/components/icons';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import styles from './math.module.css';

const knowledgeT = createTranslator(knowledgeMessages);

function SYMBOLS(locale?: Locale) {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    { label: knowledgeT('fraction'), glyph: '½', latex: '\\frac{}{}', cursor: 6 },
    { label: knowledgeT('squareRoot'), glyph: '√', latex: '\\sqrt{}', cursor: 6 },
    { label: knowledgeT('sum'), glyph: 'Σ', latex: '\\sum_{i=1}^{n}', cursor: 7 },
    { label: knowledgeT('integral'), glyph: '∫', latex: '\\int_{}^{}', cursor: 6 },
    { label: knowledgeT('greekLetter'), glyph: 'α', latex: '\\alpha', cursor: 6 },
    { label: knowledgeT('subscript'), glyph: 'xₙ', latex: '_{}', cursor: 2 },
    { label: knowledgeT('superscript'), glyph: 'x²', latex: '^{}', cursor: 2 },
    {
      label: knowledgeT('matrix'),
      glyph: '▦',
      latex: '\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}',
      cursor: 15,
    },
  ] as const;
}

function renderFormula(latex: string) {
  if (!latex.trim()) return { html: '', error: null };
  try {
    return {
      html: katex.renderToString(latex, {
        displayMode: true,
        throwOnError: true,
        trust: false,
        output: 'html',
      }),
      error: null,
    };
  } catch (error) {
    return {
      html: '',
      error: error instanceof Error ? error.message : knowledgeT('invalidEquationSyntax'),
    };
  }
}
export function MathNodeView({ node, editor, updateAttributes, HTMLAttributes }: NodeViewProps) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const latex = String(node.attrs.latex ?? '');
  const rendered = useMemo(() => renderFormula(latex), [latex]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(latex);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  const insertSymbol = (snippet: ReturnType<typeof SYMBOLS>[number]) => {
    const start = inputRef.current?.selectionStart ?? latex.length;
    const end = inputRef.current?.selectionEnd ?? start;
    updateAttributes({ latex: latex.slice(0, start) + snippet.latex + latex.slice(end) });
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(start + snippet.cursor, start + snippet.cursor);
    });
  };
  return (
    <NodeViewWrapper
      as="div"
      {...HTMLAttributes}
      data-fob-node="math"
      data-math=""
      data-latex={latex}
      data-block-id={node.attrs.blockId}
      className={styles.root}
    >
      {editor.isEditable && (
        <div className={styles.editArea} contentEditable={false} data-document-export-omit>
          <textarea
            ref={inputRef}
            aria-label={knowledgeT('latexEquationSource')}
            spellCheck={false}
            rows={Math.min(5, latex.split('\n').length)}
            value={latex}
            onChange={(event) => updateAttributes({ latex: event.target.value })}
            placeholder={knowledgeT('enterALatexEquation')}
            className={styles.input}
          />
          <div className={styles.actions}>
            {latex && (
              <button
                type="button"
                aria-label={copied ? knowledgeT('latexCopied') : knowledgeT('copyLatex')}
                onClick={copy}
              >
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              </button>
            )}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger aria-label={knowledgeT('equationShortcuts')}>
                <FunctionIcon size={16} aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={styles.symbols}>
                {SYMBOLS(locale).map((symbol) => (
                  <DropdownMenuItem
                    key={symbol.label}
                    aria-label={knowledgeT('insert') + symbol.label}
                    onSelect={() => insertSymbol(symbol)}
                  >
                    <span className={styles.glyph} aria-hidden>
                      {symbol.glyph}
                    </span>
                    {symbol.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      {rendered.html && (
        <div
          className={styles.preview}
          contentEditable={false}
          aria-live="polite"
          dangerouslySetInnerHTML={{ __html: rendered.html }}
        />
      )}
      {rendered.error && editor.isEditable && (
        <p className={styles.error} role="status" title={rendered.error} data-document-export-omit>
          {knowledgeT('invalidEquationSyntaxCheckTheLatex')}
        </p>
      )}
    </NodeViewWrapper>
  );
}
