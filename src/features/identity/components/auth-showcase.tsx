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
      agent: 'Research',
      task: uiText('梳理 AI 工作台竞品格局'),
      steps: [uiText('检索公开资料'), uiText('交叉核对关键结论'), uiText('生成结构化报告')],
      quote: [uiText('你定方向，'), uiText('剩下的路交给 Agent。')],
    },
    {
      agent: 'Writer',
      task: uiText('起草产品发布说明'),
      steps: [uiText('读取产品需求与变更'), uiText('撰写不同语气的草稿'), uiText('提交给你审阅')],
      quote: [uiText('思考是你的，'), uiText('执行是它的。')],
    },
    {
      agent: 'Developer',
      task: uiText('把想法变成可用的产品'),
      steps: [uiText('理解需求与设计'), uiText('实现并验证交互'), uiText('交付可审阅的成果')],
      quote: [uiText('从一个想法，'), uiText('到下一步行动。')],
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
          <span>{uiText('AI工作台')}</span>
        </div>
        <div className={styles.example} key={exampleIndex}>
          <div className={styles.exampleHeader}>
            <span>Agent · {uiText(example.agent)}</span>
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
              <i key={item.agent} data-active={index === exampleIndex} />
            ))}
          </span>
          <span>0{exampleIndex + 1} / 03</span>
        </div>
      </div>
    </aside>
  );
}
