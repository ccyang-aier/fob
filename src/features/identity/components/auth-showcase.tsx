'use client';

import { type Locale } from '@/lib/i18n/locale';
import { createTranslator } from '@/lib/i18n/messages';
import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/auth-showcase.messages';

import { useEffect, useState } from 'react';
import { Check, CircleNotch } from '@phosphor-icons/react';
import { FobMark } from '@/components/fob-mark';
import { AuthBackdrop } from './auth-backdrop';
import styles from './account-dialog.module.css';

function getExamples(locale: Locale) {
  const uiText = createTranslator(messages, locale);
  return [
    {
      category: 'organize',
      task: uiText('organizeTask'),
      steps: [uiText('importResources'), uiText('organizeFolders'), uiText('connectDocuments')],
      quote: [uiText('organizeQuoteFirst'), uiText('organizeQuoteSecond')],
    },
    {
      category: 'collaborate',
      task: uiText('collaborateTask'),
      steps: [uiText('writeFindings'), uiText('discussComments'), uiText('retainHistory')],
      quote: [uiText('collaborateQuoteFirst'), uiText('collaborateQuoteSecond')],
    },
    {
      category: 'find',
      task: uiText('findTask'),
      steps: [uiText('searchKnowledge'), uiText('readSources'), uiText('citePassages')],
      quote: [uiText('findQuoteFirst'), uiText('findQuoteSecond')],
    },
  ] as const;
}

/** Decorative, local-only preview. It never represents a running user task. */
export function AuthShowcase() {
  const { t: uiText, locale } = useTranslation(messages);
  const examples = getExamples(locale);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1800);
    return () => window.clearInterval(timer);
  }, []);
  const exampleIndex = Math.floor(tick / 4) % examples.length;
  const stepIndex = tick % 4;
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
        <div className={styles.example} key={exampleIndex}>
          <div className={styles.exampleHeader}>
            <span>{uiText(example.category)}</span>
            <span className={styles.exampleLabel}>{uiText('协作示例')}</span>
          </div>
          <p className={styles.exampleTitle}>{example.task}</p>
          <div className={styles.steps}>
            {example.steps.map((step, index) => (
              <div
                className={styles.step}
                data-progress={
                  index < stepIndex ? 'done' : index === stepIndex ? 'active' : 'pending'
                }
                key={step}
              >
                <span className={styles.stepIcon}>
                  {index < stepIndex ? (
                    <Check size={10} weight="bold" />
                  ) : index === stepIndex ? (
                    <CircleNotch size={16} />
                  ) : null}
                </span>
                <span>{step}</span>
              </div>
            ))}
          </div>
          <div className={styles.progress} aria-hidden>
            <span style={{ width: `${(Math.min(stepIndex + 1, 3) / 3) * 100}%` }} />
          </div>
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
