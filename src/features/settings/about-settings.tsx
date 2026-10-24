'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/about-settings.messages';

/**
 * 关于：品牌、版本与产品定位 —— 静态事实信息。
 */

import Image from 'next/image';

import { PanelHeader } from './general-settings';

export const FOB_VERSION = '0.1.0';

export function AboutSettings() {
  const uiText = useTranslation(messages).t;
  return (
    <div className="mx-auto w-full max-w-[960px] px-10 pb-14 pt-11 max-[1100px]:px-7 max-[900px]:pt-7">
      <PanelHeader title={uiText('关于')} />

      <section className="mt-5 rounded-[12px] border border-[var(--line)] bg-panel px-6 py-6 shadow-[0_1px_2px_rgba(23,25,27,0.04)]">
        <div className="flex items-center gap-4">
          <span className="relative size-12 shrink-0 overflow-hidden rounded-[12px]">
            <Image
              src="/brand/fob-mark.png"
              alt={uiText('Fob 标识')}
              fill
              sizes="48px"
              draggable={false}
              className="scale-[1.5] object-contain"
            />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold tracking-[-0.01em]">
              {uiText('productTitle')}
            </h3>
            <p className="mt-0.5 text-[11.5px] text-[var(--muted)]">
              {uiText('versionSummary', { version: FOB_VERSION })}
            </p>
          </div>
        </div>
        <p className="mt-5 text-[12.5px] leading-relaxed text-[var(--ink-soft)]">
          {uiText(
            'productSummary',
          )}
        </p>
        <div className="mt-5 border-t border-[var(--line)] pt-4 text-[11.5px] leading-relaxed text-[var(--muted)]">
          {uiText(
            'capabilitySummary',
          )}
        </div>
      </section>
    </div>
  );
}
