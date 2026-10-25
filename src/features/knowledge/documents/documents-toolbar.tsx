'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './documents-toolbar.messages';
import {
  ArrowsDownUp,
  CaretDown,
  DotsThree,
  Funnel,
  MagnifyingGlass,
  Plus,
  SidebarSimple,
  UploadSimple,
  X,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ViewSwitcher } from '@/components/ui/view-switcher';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconButton } from '../dense-sidebar/icon-button';
import styles from './documents-page.module.css';

type Props = {
  count: number;
  search: string;
  onSearch: (value: string) => void;
  filter: string;
  formats: string[];
  onFilter: (value: string) => void;
  ascending: boolean;
  onSort: () => void;
  layout: 'table' | 'grid';
  onLayout: (value: 'table' | 'grid') => void;
  canEdit: boolean;
  onCreate: () => void;
  onCreateFolder?: () => void;
  onUpload: () => void;
  onReset: () => void;
  selectedCount: number;
  onExport: () => void;
  onExpandSidebar?: () => void;
};

export function DocumentsToolbar({
  count,
  search,
  onSearch,
  filter,
  formats,
  onFilter,
  ascending,
  onSort,
  layout,
  onLayout,
  canEdit,
  onCreate,
  onCreateFolder,
  onUpload,
  onReset,
  selectedCount,
  onExport,
  onExpandSidebar,
}: Props) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <header className={styles.toolbar}>
      <div className={styles.heading}>
        {onExpandSidebar ? (
          <IconButton
            label={knowledgeT('expandKnowledgeBaseSidebar')}
            tooltip={knowledgeT('expandSidebar')}
            onClick={onExpandSidebar}
            className={styles.sidebarToggle}
          >
            <SidebarSimple size={16} />
          </IconButton>
        ) : null}
        <h1>{knowledgeT('document')}</h1>
        <span>{count}</span>
      </div>
      <div className={styles.tools}>
        <label className={styles.search}>
          <MagnifyingGlass size={16} />
          <input
            aria-label={knowledgeT('searchDocuments')}
            placeholder={knowledgeT('searchDocuments')}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
          {search ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={knowledgeT('clearSearch')}
              onClick={() => onSearch('')}
              className={styles.clearSearch}
            >
              <X size={14} />
            </Button>
          ) : null}
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={styles.control}
              data-active={filter !== 'all'}
            >
              <Funnel size={16} />
              {knowledgeT('filter')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={filter} onValueChange={onFilter}>
              <DropdownMenuRadioItem value="all">{knowledgeT('allFormats')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="starred">
                {knowledgeT('starredDocumentsOnly')}
              </DropdownMenuRadioItem>
              {formats.map((format) => (
                <DropdownMenuRadioItem key={format} value={format}>
                  {format}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={filter === 'all'} onSelect={() => onFilter('all')}>
                {knowledgeT('resetFilters')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          size="sm"
          className={styles.control}
          title={ascending ? knowledgeT('newestUpdateFirst') : knowledgeT('oldestUpdateFirst')}
          aria-label={knowledgeT('changeUpdatedTimeSort')}
          onClick={onSort}
        >
          <ArrowsDownUp size={16} />
        </Button>
        <ViewSwitcher
          value={layout === 'table' ? 'list' : 'grid'}
          onValueChange={(mode) => onLayout(mode === 'list' ? 'table' : 'grid')}
          listLabel={knowledgeT('fileListView')}
          gridLabel={knowledgeT('fileGridView')}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={styles.control} disabled={!canEdit}>
              <Plus size={16} />
              {knowledgeT('new')}
              <CaretDown className={styles.caret} size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onCreate}>{knowledgeT('newDocument')}</DropdownMenuItem>
              {onCreateFolder ? (
                <DropdownMenuItem onSelect={onCreateFolder}>
                  {knowledgeT('newFolder')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" className={styles.upload} disabled={!canEdit} onClick={onUpload}>
          <UploadSimple size={16} />
          {knowledgeT('upload')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={styles.more}
              aria-label={knowledgeT('moreDocumentViewActions')}
            >
              <DotsThree size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onReset}>{knowledgeT('resetView')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!selectedCount} onSelect={onExport}>
                {knowledgeT('exportSelectedDocumentList')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
