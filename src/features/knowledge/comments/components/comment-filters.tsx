'use client';

import { createTranslator, useTranslation, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './comment-filters.messages';
import { ArrowsDownUp, CaretDown, SlidersHorizontal } from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { defaultCommentFilters, type CommentFilters } from '../comments-view-model';
import styles from './comments.module.css';

function kinds(locale?: Locale) {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    ['all', knowledgeT('allComments')],
    ['comment', knowledgeT('comments')],
    ['issue', knowledgeT('allQuestions')],
    ['open', knowledgeT('unresolvedQuestions')],
    ['resolved', knowledgeT('resolvedQuestions')],
  ] as const;
}
function likes(locale?: Locale) {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    ['all', knowledgeT('anyLikes')],
    ['mine', knowledgeT('likedByMe')],
    ['popular', knowledgeT('mostLiked')],
  ] as const;
}
function times(locale?: Locale) {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    ['all', knowledgeT('anyTime')],
    ['week', knowledgeT('last7Days')],
    ['month', knowledgeT('last30Days')],
  ] as const;
}
function sorts(locale?: Locale) {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    ['all', knowledgeT('documentPosition')],
    ['newest', knowledgeT('newestFirst')],
    ['oldest', knowledgeT('oldestFirst')],
  ] as const;
}

export function CommentFilterControls({
  value,
  onChange,
}: {
  value: CommentFilters;
  onChange: (next: CommentFilters) => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const filtered = value.likes !== 'all' || value.time !== 'all';
  return (
    <div className={styles.filters} role="group" aria-label={knowledgeT('commentFilters')}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={styles.scopeButton}
            data-filtered={value.kind !== 'all'}
            aria-label={knowledgeT('commentType')}
          >
            <span>{kinds(locale).find((option) => option[0] === value.kind)?.[1]}</span>
            <CaretDown size={13} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className={styles.filterMenu} align="start">
          <DropdownMenuRadioGroup
            value={value.kind}
            onValueChange={(kind) => onChange({ ...value, kind: kind as CommentFilters['kind'] })}
          >
            {kinds(locale).map(([id, label]) => (
              <DropdownMenuRadioItem key={id} value={id}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={styles.filterButton}
            data-filtered={filtered}
            aria-label={knowledgeT('filterComments')}
          >
            <SlidersHorizontal size={16} aria-hidden />
            {knowledgeT('filter')}
            {filtered && <span className={styles.filterDot} />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className={styles.filterMenu} align="end">
          <DropdownMenuLabel>{knowledgeT('filterByLikes')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value.likes}
            onValueChange={(next) => onChange({ ...value, likes: next as CommentFilters['likes'] })}
          >
            {likes(locale).map(([id, label]) => (
              <DropdownMenuRadioItem key={id} value={id}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{knowledgeT('timeRange')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value.time}
            onValueChange={(next) => onChange({ ...value, time: next as CommentFilters['time'] })}
          >
            {times(locale).map(([id, label]) => (
              <DropdownMenuRadioItem key={id} value={id}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onChange(defaultCommentFilters)}>
            {knowledgeT('clearFilters')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={styles.sortButton}
            data-filtered={value.sort !== 'all'}
            aria-label={knowledgeT('sortComments')}
            title={knowledgeT('sortComments')}
          >
            <ArrowsDownUp size={16} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className={styles.filterMenu} align="end">
          <DropdownMenuRadioGroup
            value={value.sort}
            onValueChange={(next) => onChange({ ...value, sort: next as CommentFilters['sort'] })}
          >
            {sorts(locale).map(([id, label]) => (
              <DropdownMenuRadioItem key={id} value={id}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
