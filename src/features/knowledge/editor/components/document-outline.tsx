'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './document-outline.messages';
import { useState } from 'react';
import { Minus, Plus } from '@/components/icons';
import styles from './document-outline.module.css';

export function DocumentOutline({
  id,
  headings,
  activeHeading,
  onClose,
  onNavigate,
}: {
  id: string;
  headings: { id: string; pos: number; level: number; title: string }[];
  activeHeading: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const rows: {
    heading: (typeof headings)[number];
    index: number;
    ancestors: number[];
    hasNext: boolean;
  }[] = [];
  const ancestors: number[] = [];
  const lastChild = new Map<number | undefined, (typeof rows)[number]>();
  for (const [index, heading] of headings.entries()) {
    while (ancestors.length && headings[ancestors[ancestors.length - 1]].level >= heading.level)
      ancestors.pop();
    const parent = ancestors[ancestors.length - 1];
    const previous = lastChild.get(parent);
    if (previous) previous.hasNext = true;
    const row = { heading, index, ancestors: [...ancestors], hasNext: false };
    rows.push(row);
    lastChild.set(parent, row);
    ancestors.push(index);
  }
  return (
    <div
      id={id}
      className={styles.panel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {headings.length ? (
        <nav className={styles.chapters} aria-label={knowledgeT('documentSections')}>
          {rows.map(({ heading, index, ancestors: parents, hasNext }) => {
            if (parents.some((parent) => collapsed.has(headings[parent].id))) return null;
            const depth = parents.length;
            const hasChildren = rows[index + 1]?.ancestors.includes(index) ?? false;
            const isCollapsed = collapsed.has(heading.id);
            const active =
              index === activeHeading ||
              (isCollapsed && rows[activeHeading]?.ancestors.includes(index));
            return (
              <div
                key={heading.id}
                className={styles.chapter}
                data-root={depth === 0}
                data-active={Boolean(active)}
                style={{ paddingInlineStart: `${8 + depth * 16}px` }}
              >
                {parents
                  .slice(1)
                  .map(
                    (parent, level) =>
                      rows[parent].hasNext && (
                        <span
                          key={parent}
                          aria-hidden
                          className={styles.guide}
                          style={{ insetInlineStart: `${12 + level * 16}px` }}
                        />
                      ),
                  )}
                {depth > 0 && (
                  <span
                    aria-hidden
                    className={styles.branch}
                    data-last={!hasNext}
                    style={{ insetInlineStart: `${12 + (depth - 1) * 16}px` }}
                  />
                )}
                {hasChildren ? (
                  <button
                    type="button"
                    className={styles.fold}
                    aria-label={knowledgeT('valueSectionValue', {
                      v0: isCollapsed ? knowledgeT('expand') : knowledgeT('collapse'),
                      v1: heading.title,
                    })}
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(heading.id)) next.delete(heading.id);
                        else next.add(heading.id);
                        return next;
                      })
                    }
                  >
                    {isCollapsed ? <Plus size={12} /> : <Minus size={12} />}
                  </button>
                ) : (
                  <span className={styles.foldSpace} />
                )}
                <button
                  type="button"
                  className={styles.chapterLink}
                  aria-current={index === activeHeading ? 'location' : undefined}
                  onClick={() => onNavigate(index)}
                  title={heading.title}
                >
                  <span className={styles.chapterTitle}>{heading.title}</span>
                </button>
              </div>
            );
          })}
        </nav>
      ) : (
        <div className={styles.empty} role="status">
          <strong>{knowledgeT('noSectionsYet')}</strong>
          <p>{knowledgeT('addHeadingsToNavigateTheDocumentHere')}</p>
        </div>
      )}
    </div>
  );
}
