'use client';
import { formatNumber, useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './text-file-view.messages';
import { useMemo, useState } from 'react';
import { CaretDown, CaretRight, MagnifyingGlass } from '@phosphor-icons/react';
import { parseCsv } from './file-format';
import styles from './file-preview.module.css';

export function TextFileView({ text, format }: { text: string; format: 'csv' | 'json' | 'text' }) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [raw, setRaw] = useState(false);
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const parsed = useMemo(() => {
    try {
      return {
        value:
          format === 'json'
            ? (JSON.parse(text) as unknown)
            : format === 'csv'
              ? parseCsv(text)
              : null,
        error: '',
      };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : knowledgeT('invalidFileFormat'),
      };
    }
  }, [text, format, knowledgeT]);
  if (format === 'csv' && !parsed.error) {
    const rows = parsed.value as string[][];
    const columns = rows.reduce((count, row) => Math.max(count, row.length), 0);
    const filtered = rows
      .slice(1)
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          !query ||
          row.some((cell) => cell.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
      );
    const pages = Math.max(1, Math.ceil(filtered.length / 100));
    const current = Math.min(page, pages - 1);
    return (
      <div className={styles.csv}>
        <div className={styles.dataToolbar}>
          <span>
            {formatNumber(filtered.length, undefined, locale)}{' '}
            {knowledgeT(filtered.length === 1 ? 'oneRowWithSeparator' : 'rows')} {columns}{' '}
            {knowledgeT(columns === 1 ? 'oneColumn' : 'columns')}
          </span>
          <label>
            <MagnifyingGlass size={15} />
            <input
              aria-label={knowledgeT('filterTableContent')}
              placeholder={knowledgeT('filterContent')}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        <div className={styles.tableScroll}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                {Array.from({ length: columns }, (_, index) => (
                  <th key={index}>
                    {rows[0]?.[index] || knowledgeT('columnValue', { v0: index + 1 })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(current * 100, current * 100 + 100).map(({ row, index }) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  {Array.from({ length: columns }, (_, cell) => (
                    <td key={cell}>{row[cell] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <div className={styles.state}>
              {query ? knowledgeT('noMatchingData') : knowledgeT('noDataRowsInThisTable')}
            </div>
          )}
        </div>
        <footer className={styles.dataToolbar}>
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            {knowledgeT('previousPage')}
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button disabled={current === pages - 1} onClick={() => setPage(current + 1)}>
            {knowledgeT('nextPage')}
          </button>
        </footer>
      </div>
    );
  }
  if (format === 'json' && !parsed.error && !raw)
    return (
      <div className={styles.json}>
        <div className={styles.dataToolbar}>
          <span>{knowledgeT('json')}</span>
          <button onClick={() => setRaw(true)}>{knowledgeT('viewSource')}</button>
        </div>
        <div className={styles.jsonBody}>
          <JsonNode value={parsed.value} depth={0} />
        </div>
      </div>
    );
  return (
    <div className={styles.text}>
      {parsed.error ? (
        <p role="alert" className={styles.error}>
          {knowledgeT('unableToParseFormat')}
          {parsed.error}
          {knowledgeT('theCompleteOriginalTextIsShownBelow')}
        </p>
      ) : null}
      <div className={styles.dataToolbar}>
        <span>
          {formatNumber(lines.length, undefined, locale)}{' '}
          {knowledgeT(lines.length === 1 ? 'oneRow' : 'rows2')}
        </span>
        {format === 'json' && !parsed.error ? (
          <button onClick={() => setRaw(false)}>{knowledgeT('structureView')}</button>
        ) : null}
      </div>
      <pre>
        {lines.slice(page * 500, page * 500 + 500).map((line, index) => (
          <div key={index}>
            <span aria-hidden>{page * 500 + index + 1}</span>
            <code>{line || '\u00a0'}</code>
          </div>
        ))}
      </pre>
      {lines.length > 500 && (
        <footer className={styles.dataToolbar}>
          <button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
            {knowledgeT('previousPage')}
          </button>
          <span>
            {page + 1} / {Math.ceil(lines.length / 500)}
          </span>
          <button
            disabled={(page + 1) * 500 >= lines.length}
            onClick={() => setPage((value) => value + 1)}
          >
            {knowledgeT('nextPage')}
          </button>
        </footer>
      )}
    </div>
  );
}
function JsonNode({ value, name, depth }: { value: unknown; name?: string; depth: number }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [open, setOpen] = useState(depth < 2);
  const [limit, setLimit] = useState(100);
  const composite = value !== null && typeof value === 'object';
  const entries = composite ? Object.entries(value) : [];
  const array = Array.isArray(value);
  return (
    <div className={styles.jsonNode}>
      <div>
        {composite ? (
          <button
            aria-label={`${open ? knowledgeT('collapse') : knowledgeT('expand')}${name ?? knowledgeT('rootNode')}`}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? <CaretDown size={13} /> : <CaretRight size={13} />}
          </button>
        ) : (
          <span className={styles.jsonSpacer} />
        )}
        {name !== undefined && (
          <span className={styles.jsonKey}>
            {JSON.stringify(name)}
            <span>: </span>
          </span>
        )}
        {composite ? (
          <button className={styles.jsonValue} onClick={() => setOpen((current) => !current)}>
            {array ? '[' : '{'}
            {!open && (
              <span>
                {' '}
                {entries.length} {knowledgeT(entries.length === 1 ? 'oneItem' : 'items')}
                {array ? ']' : '}'}
              </span>
            )}
          </button>
        ) : (
          <span data-kind={typeof value} className={styles.jsonPrimitive}>
            {JSON.stringify(value)}
          </span>
        )}
      </div>
      {composite && open && (
        <>
          <div className={styles.jsonChildren}>
            {entries.slice(0, limit).map(([key, child]) => (
              <JsonNode key={key} name={key} value={child} depth={depth + 1} />
            ))}
            {entries.length > limit && (
              <button
                className={styles.moreNodes}
                onClick={() => setLimit((current) => current + 100)}
              >
                {knowledgeT('showMoreRemaining')} {entries.length - limit}{' '}
                {knowledgeT(entries.length - limit === 1 ? 'oneItemWithClose' : 'items2')}
              </button>
            )}
          </div>
          <div className={styles.jsonEnd}>{array ? ']' : '}'}</div>
        </>
      )}
    </div>
  );
}
