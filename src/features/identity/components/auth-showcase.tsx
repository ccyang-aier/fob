'use client';

import { type Locale } from '@/lib/i18n/locale';
import { createTranslator } from '@/lib/i18n/messages';
import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/auth-showcase.messages';

import { useEffect, useState } from 'react';
import { FobMark } from '@/components/fob-mark';
import { AuthBackdrop } from './auth-backdrop';
import styles from './account-dialog.module.css';

function getExamples(locale: Locale) {
  const uiText = createTranslator(messages, locale);
  return [
    {
      category: 'organize',
      quote: [uiText('organizeQuoteFirst'), uiText('organizeQuoteSecond')],
    },
    {
      category: 'collaborate',
      quote: [uiText('collaborateQuoteFirst'), uiText('collaborateQuoteSecond')],
    },
    {
      category: 'find',
      quote: [uiText('findQuoteFirst'), uiText('findQuoteSecond')],
    },
  ] as const;
}

/** Product copy rotates independently of the interactive background. */
export function AuthShowcase() {
  const { t: uiText, locale } = useTranslation(messages);
  const examples = getExamples(locale);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 7200);
    return () => window.clearInterval(timer);
  }, []);
  const exampleIndex = tick % examples.length;
  const example = examples[exampleIndex];
  return (
    <aside className={styles.showcase} aria-label={uiText('Fob 协作示例')}>
      <AuthBackdrop />
      <div className={styles.showcaseContent}>
        <div className={styles.brand}>
          <FobMark compact />
          <b>Fob</b>
          <span>{uiText('knowledgeCollaboration')}</span>
        </div>
        <p className={styles.quote} key={example.quote[0]}>
          {example.quote[0]}
          <br />
          <em>{example.quote[1]}</em>
        </p>
        <div className={styles.showcaseFooter}>
          <span className={styles.pages} aria-hidden>
            {examples.map((item, index) => (
              <i key={item.category} data-active={index === exampleIndex} />
            ))}
          </span>
          <span>0{exampleIndex + 1} / 03</span>
        </div>
      </div>
    </aside>
  );
}
