import { formatDate, useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './document-collection.messages';
import type { ReactNode } from 'react';
import { ArrowDown, CheckCircle, Desktop } from '@/components/icons';
import { FileBadge, formatOf } from './document-visuals';
import type { DocumentItem } from './types';
import { documentIndexStatusLabel, documentSourceLabel } from './document-metadata';
import styles from './documents-page.module.css';
export function DocumentCollection({
  layout,
  shown,
  selected,
  selectedCount,
  setSelected,
  toggle,
  ascending,
  setAscending,
  onOpen,
  renderMenu,
}: {
  layout: 'table' | 'grid';
  shown: DocumentItem[];
  selected: Set<string>;
  selectedCount: number;
  setSelected: (ids: Set<string>) => void;
  toggle: (id: string) => void;
  ascending: boolean;
  setAscending: (value: boolean) => void;
  onOpen: (id: string) => void;
  renderMenu: (id: string) => ReactNode;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);
  return layout === 'table' ? (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                aria-label={knowledgeT('selectAllDocuments')}
                checked={shown.length > 0 && selectedCount === shown.length}
                ref={(node) => {
                  if (node) node.indeterminate = selectedCount > 0 && selectedCount < shown.length;
                }}
                onChange={(event) =>
                  setSelected(
                    event.target.checked ? new Set(shown.map((doc) => doc.id)) : new Set(),
                  )
                }
              />
            </th>
            <th>{knowledgeT('name')}</th>
            <th>{knowledgeT('format')}</th>
            <th>{knowledgeT('creator')}</th>
            <th>
              <button onClick={() => setAscending(!ascending)}>
                {knowledgeT('updated')}
                <ArrowDown
                  size={14}
                  style={{ transform: ascending ? 'rotate(180deg)' : undefined }}
                />
              </button>
            </th>
            <th>{knowledgeT('source')}</th>
            <th>{knowledgeT('indexStatus')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((doc) => (
            <tr key={doc.id} data-document-id={doc.id} data-selected={selected.has(doc.id)}>
              <td>
                <input
                  type="checkbox"
                  aria-label={knowledgeT('selectValue', { v0: doc.title })}
                  checked={selected.has(doc.id)}
                  onChange={() => toggle(doc.id)}
                />
              </td>
              <td>
                <button className={styles.documentName} onClick={() => onOpen(doc.id)}>
                  <FileBadge title={doc.title} icon={doc.icon} />
                  <span>{doc.title || knowledgeT('untitledDocument')}</span>
                </button>
              </td>
              <td>{formatOf(doc.title)}</td>
              <td>
                <span className={styles.creator}>
                  <span>{doc.creator.slice(0, 1)}</span>
                  {doc.creator}
                </span>
              </td>
              <td>
                {formatDate(
                  doc.updatedAt,
                  {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  },
                  locale,
                )}
              </td>
              <td>
                <span className={styles.source} data-document-source={doc.source}>
                  <Desktop size={16} />
                  {documentSourceLabel(doc.source, locale)}
                </span>
              </td>
              <td>
                <span className={styles.status} data-index-status={doc.status}>
                  {doc.status === 'indexed' ? (
                    <CheckCircle size={16} />
                  ) : (
                    <span className={styles.statusDot} />
                  )}
                  {documentIndexStatusLabel(doc.status, locale)}
                </span>
              </td>
              <td>{renderMenu(doc.id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className={styles.fileGrid}>
      {shown.map((doc) => (
        <article key={doc.id} data-document-id={doc.id}>
          <button onClick={() => onOpen(doc.id)}>
            <FileBadge title={doc.title} icon={doc.icon} />
            <strong>{doc.title}</strong>
            <small>
              {formatDate(
                doc.updatedAt,
                { year: 'numeric', month: 'short', day: 'numeric' },
                locale,
              )}{' '}
              · {documentSourceLabel(doc.source, locale)}
            </small>
          </button>
          {renderMenu(doc.id)}
        </article>
      ))}
    </div>
  );
}
