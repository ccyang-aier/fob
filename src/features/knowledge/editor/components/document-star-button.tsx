'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './document-star-button.messages';
import { DocumentStarIcon, useDocumentStarFeedback } from './document-star-icon';
import styles from './document-star-button.module.css';

export function DocumentStarButton({
  starred,
  onToggle,
}: {
  starred: boolean;
  onToggle: () => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const feedback = useDocumentStarFeedback(starred, onToggle);
  const label = starred ? knowledgeT('unstar') : knowledgeT('star');

  return (
    <button
      type="button"
      className={`fob-action ${styles.button}`}
      aria-label={label}
      title={label}
      aria-pressed={starred}
      onClick={feedback.toggle}
    >
      <DocumentStarIcon
        starred={starred}
        celebrating={feedback.celebrating}
        onAnimationEnd={feedback.finish}
      />
    </button>
  );
}
