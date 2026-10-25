'use client';

import { formatDate, useTranslation, createTranslator, type Locale } from '@/lib/i18n';
import { useUiMessage } from '../../../ui-message';
import { knowledgeMessages } from './database-view-node-view.messages';
import { useEffect, useMemo, useState } from 'react';
import {
  CalendarBlank,
  CaretLeft,
  CaretRight,
  Database,
  FileText,
  Kanban,
  MagnifyingGlass,
  Plus,
  Table,
} from '@/components/icons';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import type {
  DatabaseRowSummary,
  PageScope,
  PropertyDefinition,
} from '@fob/shared/knowledge/contracts';
import { DatabaseTableView } from '../../../databases';
import { knowledgeDatabasesApi } from '../../../databases/database-api';
import { useDatabaseColumnsQuery, useDatabaseRowsQuery } from '../../../databases/database-queries';
import { fetchKnowledgePages } from '../../../data/pages-api';
import { requestOpenPageBlock } from '../../open-target';
import styles from './database-view.module.css';

type View = 'table' | 'board' | 'calendar';
function VIEWS(locale?: Locale) {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    { value: 'table', label: knowledgeT('table'), icon: Table },
    { value: 'board', label: knowledgeT('board'), icon: Kanban },
    { value: 'calendar', label: knowledgeT('calendar'), icon: CalendarBlank },
  ] as const;
}

export function DatabaseViewNodeView({ scope, ...props }: NodeViewProps & { scope?: PageScope }) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const { node, editor, updateAttributes, HTMLAttributes } = props;
  const [open, setOpen] = useState(!node.attrs.databaseId);
  const [query, setQuery] = useState('');
  const [databases, setDatabases] = useState<readonly { id: string; title: string }[]>([]);
  const [listError, setListError] = useState(false);
  const [teamspaceId, setTeamspaceId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useUiMessage(knowledgeMessages, '');
  const databaseId = node.attrs.databaseId ? String(node.attrs.databaseId) : null;
  const view = node.attrs.view as View;

  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    fetchKnowledgePages(scope.knowledgeBaseId, {}, controller.signal)
      .then((pages) => {
        setDatabases(
          pages
            .filter((page) => page.kind === 'database')
            .map((page) => ({ id: page.id, title: page.title })),
        );
        setTeamspaceId(pages.find((page) => page.id === scope.pageId)?.teamspaceId ?? null);
        setListError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setListError(true);
      });
    return () => controller.abort();
  }, [scope]);

  const title = databases.find((item) => item.id === databaseId)?.title ?? knowledgeT('database');
  const matches = databases.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase()),
  );
  const openRow = (pageId: string) => {
    if (scope) requestOpenPageBlock({ knowledgeBaseId: scope.knowledgeBaseId, pageId });
  };
  const createDatabase = async () => {
    if (!scope || !teamspaceId) return;
    setCreating(true);
    setCreateError('');
    const id = crypto.randomUUID();
    try {
      await knowledgeDatabasesApi.createDatabase(scope.knowledgeBaseId, {
        id,
        knowledgeBaseId: scope.knowledgeBaseId,
        teamspaceId,
        parentId: scope.pageId,
        title: knowledgeT('newDatabase'),
        icon: null,
        cover: null,
        inheritsPermissions: true,
        afterPageId: null,
        columns: [
          {
            id: 'status',
            name: knowledgeT('status'),
            type: 'select',
            options: [
              { id: 'todo', label: knowledgeT('toDo'), color: 'gray' },
              { id: 'doing', label: knowledgeT('inProgress'), color: 'blue' },
              { id: 'done', label: knowledgeT('completed'), color: 'green' },
            ],
          },
          { id: 'date', name: knowledgeT('date'), type: 'date' },
        ],
      });
      setDatabases((items) => [...items, { id, title: knowledgeT('newDatabase') }]);
      updateAttributes({ databaseId: id });
      setOpen(false);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : { key: 'unableToCreateDatabase' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <NodeViewWrapper
      as="div"
      {...HTMLAttributes}
      data-fob-node="database-view"
      data-block-id={node.attrs.blockId}
      className={styles.root}
      contentEditable={false}
    >
      <div className={styles.header}>
        <span className={styles.heading}>
          <Database aria-hidden size={16} />
          {title}
        </span>
        {databaseId && editor.isEditable ? (
          <button
            type="button"
            className={styles.change}
            onClick={() => setOpen((value) => !value)}
          >
            {knowledgeT('changeDatabase')}
          </button>
        ) : null}
      </div>
      {open || !databaseId ? (
        <div className={styles.picker}>
          <p>{knowledgeT('chooseADatabaseInThisKnowledgeBase')}</p>
          {scope ? (
            <>
              <div className={styles.search}>
                <MagnifyingGlass aria-hidden size={14} />
                <input
                  aria-label={knowledgeT('searchDatabases')}
                  value={query}
                  placeholder={knowledgeT('searchDatabases2')}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className={styles.choices}>
                {listError ? (
                  <span>{knowledgeT('databaseListUnavailable')}</span>
                ) : matches.length ? (
                  matches.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        updateAttributes({ databaseId: item.id });
                        setOpen(false);
                      }}
                    >
                      <Database aria-hidden size={16} />
                      {item.title}
                    </button>
                  ))
                ) : (
                  <span>
                    {query
                      ? knowledgeT('noMatchingDatabases')
                      : knowledgeT('noDatabasesInThisKnowledgeBaseYet')}
                  </span>
                )}
              </div>
              {editor.isEditable && teamspaceId ? (
                <button
                  type="button"
                  className={styles.create}
                  disabled={creating}
                  onClick={() => void createDatabase()}
                >
                  <Plus aria-hidden size={14} />
                  {creating ? knowledgeT('creating') : knowledgeT('createDatabase')}
                </button>
              ) : null}
              {createError ? (
                <p className={styles.createError} role="alert">
                  {createError}
                </p>
              ) : null}
            </>
          ) : (
            <div className={styles.empty}>
              {knowledgeT('localKnowledgeBasesDoNotHaveDatabaseResources')}
            </div>
          )}
          {databaseId ? (
            <button type="button" className={styles.change} onClick={() => setOpen(false)}>
              {knowledgeT('cancel')}
            </button>
          ) : null}
        </div>
      ) : scope ? (
        <>
          <div className={styles.views} role="tablist" aria-label={knowledgeT('databaseView')}>
            {VIEWS(locale).map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={view === item.value}
                onClick={() => updateAttributes({ view: item.value })}
              >
                <item.icon aria-hidden size={15} />
                {item.label}
              </button>
            ))}
          </div>
          <div className={styles.content}>
            {view === 'table' ? (
              <DatabaseTableView
                scope={{ knowledgeBaseId: scope.knowledgeBaseId, pageId: databaseId }}
                title={title}
                onOpenRow={openRow}
              />
            ) : (
              <DatabaseAlternateView
                knowledgeBaseId={scope.knowledgeBaseId}
                databaseId={databaseId}
                view={view}
                onOpenRow={openRow}
              />
            )}
          </div>
        </>
      ) : null}
    </NodeViewWrapper>
  );
}

function DatabaseAlternateView({
  knowledgeBaseId,
  databaseId,
  view,
  onOpenRow,
}: {
  knowledgeBaseId: string;
  databaseId: string;
  view: 'board' | 'calendar';
  onOpenRow: (pageId: string) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const columnsQuery = useDatabaseColumnsQuery(knowledgeBaseId, databaseId);
  const rowsQuery = useDatabaseRowsQuery(knowledgeBaseId, databaseId, [], []);
  const rows = useMemo(
    () => rowsQuery.data?.pages.flatMap((page) => page.rows) ?? [],
    [rowsQuery.data],
  );
  const columns = columnsQuery.data?.columns ?? [];
  if (columnsQuery.isPending || rowsQuery.isPending)
    return <div className={styles.empty}>{knowledgeT('loadingDatabase')}</div>;
  if (columnsQuery.isError || rowsQuery.isError)
    return (
      <div className={styles.empty} role="alert">
        {knowledgeT('unableToReadDatabaseViewRetryLater')}
      </div>
    );
  return (
    <>
      {view === 'board' ? (
        <BoardView columns={columns} rows={rows} onOpenRow={onOpenRow} />
      ) : (
        <CalendarView columns={columns} rows={rows} onOpenRow={onOpenRow} />
      )}
      {rowsQuery.hasNextPage ? (
        <button
          type="button"
          className={styles.more}
          disabled={rowsQuery.isFetchingNextPage}
          onClick={() => void rowsQuery.fetchNextPage()}
        >
          {rowsQuery.isFetchingNextPage ? knowledgeT('loading') : knowledgeT('loadMoreRecords')}
        </button>
      ) : null}
    </>
  );
}

function BoardView({
  columns,
  rows,
  onOpenRow,
}: {
  columns: readonly PropertyDefinition[];
  rows: readonly DatabaseRowSummary[];
  onOpenRow: (id: string) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const property = columns.find((column) => column.type === 'select');
  const groups = property
    ? [
        { id: '', label: knowledgeT('uncategorized') },
        ...(property.options ?? []).map((item) => ({ id: item.id, label: item.label })),
      ]
    : [{ id: '', label: knowledgeT('allRecords') }];
  return (
    <div className={styles.board}>
      {groups.map((group) => {
        const items = rows.filter(
          (row) => !property || String(row.properties[property.id] ?? '') === group.id,
        );
        return (
          <section key={group.id} className={styles.boardColumn}>
            <h3>
              {group.label}
              <span>{items.length}</span>
            </h3>
            {items.map((row) => (
              <button type="button" key={row.pageId} onClick={() => onOpenRow(row.pageId)}>
                <FileText aria-hidden size={14} />
                {row.title || knowledgeT('untitled')}
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function CalendarView({
  columns,
  rows,
  onOpenRow,
}: {
  columns: readonly PropertyDefinition[];
  rows: readonly DatabaseRowSummary[];
  onOpenRow: (id: string) => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const dateProperty = columns.find((column) => column.type === 'date');
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  if (!dateProperty)
    return <div className={styles.empty}>{knowledgeT('addADatePropertyToViewRecordsIn')}</div>;
  const firstDay = (month.getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: firstDay + count }, (_, index) =>
    index < firstDay ? null : index - firstDay + 1,
  );
  return (
    <div className={styles.calendar}>
      <div className={styles.calendarHead}>
        <button
          type="button"
          aria-label={knowledgeT('previousMonth')}
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          <CaretLeft aria-hidden size={16} />
        </button>
        <strong>{formatDate(month, { year: 'numeric', month: 'long' }, locale)}</strong>
        <button
          type="button"
          aria-label={knowledgeT('nextMonth')}
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          <CaretRight aria-hidden size={16} />
        </button>
      </div>
      <div className={styles.calendarGrid}>
        {[
          knowledgeT('mon'),
          knowledgeT('tue'),
          knowledgeT('wed'),
          knowledgeT('thu'),
          knowledgeT('fri'),
          knowledgeT('sat'),
          knowledgeT('sun'),
        ].map((day) => (
          <span key={day} className={styles.weekday}>
            {day}
          </span>
        ))}
        {cells.map((day, index) => (
          <div key={index} className={styles.day}>
            {day ? (
              <>
                <span>{day}</span>
                {rows
                  .filter(
                    (row) =>
                      String(row.properties[dateProperty.id] ?? '').slice(0, 10) ===
                      `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                  )
                  .map((row) => (
                    <button type="button" key={row.pageId} onClick={() => onOpenRow(row.pageId)}>
                      {row.title || knowledgeT('untitled')}
                    </button>
                  ))}
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
