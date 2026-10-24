'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/settings-canvas.messages';

/**
 * 设置内容：保留原设置页的布局与样式，由设置弹窗承载。
 * 布局为独立的设置侧栏 + 右侧内容画布；侧栏与工作台侧栏共用同一套材质与拖拽调宽。
 */

import { useState } from 'react';
import { Info, MagnifyingGlass, PaintBrush, SlidersHorizontal } from '@phosphor-icons/react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import { NavButton, type SidebarRowItem } from '@/components/nav-button';
import { SidebarResizeHandle, useSidebarWidth } from '@/components/sidebar-resize';
import { AboutSettings } from './about-settings';
import { AppearanceSettings } from './appearance-settings';
import { GeneralSettings } from './general-settings';

export type SettingsSection = 'appearance' | 'general' | 'about';

const SECTIONS: Array<SidebarRowItem & { id: SettingsSection; label: keyof typeof messages }> = [
  { id: 'appearance', label: '外观', icon: PaintBrush },
  { id: 'general', label: '通用', icon: SlidersHorizontal },
  { id: 'about', label: '关于', icon: Info },
];

export function SettingsCanvas({
  initialSection = 'appearance',
  onSectionChange,
}: {
  initialSection?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
}) {
  const { t: uiText, locale } = useTranslation(messages);
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [previousInitialSection, setPreviousInitialSection] = useState(initialSection);
  if (previousInitialSection !== initialSection) {
    setPreviousInitialSection(initialSection);
    setSection(initialSection);
  }
  const [query, setQuery] = useState('');
  const { width, dragging, startResize } = useSidebarWidth();
  const sections = SECTIONS.map((item) => ({ ...item, label: uiText(item.label) }));
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const visibleSections = normalizedQuery
    ? sections.filter((item) => item.label.toLocaleLowerCase(locale).includes(normalizedQuery))
    : sections;

  return (
    <div
      /* 材质挂在设置页根节点：侧栏与主面板共用同一块材质底座，圆角缺口与侧栏无缝衔接 */
      className="sidebar-material flex h-full min-h-0"
      aria-label={uiText('设置')}
    >
      <div
        style={{ width, zIndex: 20 }}
        className={cn(
          'h-full shrink-0',
          !dragging && 'transition-[width] duration-[220ms] ease-out-soft',
        )}
      >
        <nav
          aria-label={uiText('设置分区')}
          className="relative flex h-full min-h-0 flex-col border-r border-[var(--wt-sidebar-edge)] px-3 pb-5 pt-3"
        >
          <div className="flex h-9 shrink-0 items-center gap-1.5">
            <span className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
              {uiText('设置')}
            </span>
          </div>

          <div className="relative mt-2.5">
            <MagnifyingGlass
              className="pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-[var(--muted)]"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={uiText('搜索设置')}
              aria-label={uiText('搜索设置')}
              className="h-[34px] w-full rounded-[6px] border border-[var(--line)] bg-panel pl-9 pr-3 text-[11.5px] text-[var(--ink)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
            />
          </div>
          <p className="mb-2 mt-5 px-2.5 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
            {uiText('偏好设置')}
          </p>
          <div className="space-y-1">
            {visibleSections.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={section === item.id}
                onSelect={() => {
                  setSection(item.id as SettingsSection);
                  onSectionChange?.(item.id as SettingsSection);
                }}
              />
            ))}
          </div>
          {visibleSections.length === 0 ? (
            <p className="px-2.5 py-4 text-[11px] text-[var(--muted)]">
              {uiText('没有匹配的设置')}
            </p>
          ) : null}

          <SidebarResizeHandle dragging={dragging} onPointerDown={startResize} />
        </nav>
      </div>

      <ScrollArea
        as="main"
        scrollbar={false}
        className="min-h-0 flex-1 overflow-hidden bg-panel"
        viewportClassName="bg-panel"
      >
        {section === 'appearance' ? (
          <AppearanceSettings />
        ) : section === 'general' ? (
          <GeneralSettings />
        ) : (
          <AboutSettings />
        )}
      </ScrollArea>
    </div>
  );
}
