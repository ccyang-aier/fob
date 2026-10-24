'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/appearance-settings.messages';

/**
 * 外观设置：深浅模式与字体偏好。
 * 偏好经 lib/appearance 的外部存储管理（useSyncExternalStore 订阅），
 * 修改即时应用到整个工作台并持久化；首帧直接读取本地偏好，无默认值闪变。
 */

import { useCallback, useSyncExternalStore } from 'react';

import {
  applyAppearancePrefs,
  getAppearanceServerSnapshot,
  getAppearanceSnapshot,
  resolveTheme,
  subscribeAppearance,
  type AppearancePrefs,
} from '@/lib/appearance';

import { FontSection } from './appearance/font-section';
import { ThemeSection } from './appearance/theme-section';
import { PanelHeader } from './general-settings';

export function AppearanceSettings() {
  const uiText = useTranslation(messages).t;
  const prefs = useSyncExternalStore(
    subscribeAppearance,
    getAppearanceSnapshot,
    getAppearanceServerSnapshot,
  );

  const update = useCallback((patch: Partial<AppearancePrefs>) => {
    applyAppearancePrefs({ ...getAppearanceSnapshot(), ...patch });
  }, []);

  return (
    <div className="mx-auto w-full max-w-[960px] px-10 pb-14 pt-11 max-[1100px]:px-7 max-[900px]:pt-7">
      <PanelHeader title={uiText('外观')} />
      <ThemeSection
        value={prefs.theme}
        resolved={resolveTheme(prefs.theme)}
        onChange={(theme) => update({ theme })}
      />
      <FontSection prefs={prefs} onChange={update} />
    </div>
  );
}
