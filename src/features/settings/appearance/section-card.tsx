"use client"

/**
 * 外观页分区骨架：标题置于卡片之外，
 * 卡片只承载内容主体，与设置的「运行状态」卡同一面板家族。
 */

export function SettingsSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-7 first:mt-6">
      <header className="flex items-baseline gap-2.5 px-0.5">
        <h2 className="shrink-0 text-[13.5px] font-semibold tracking-[-0.01em]">{title}</h2>
      </header>
      <div className="mt-2.5 rounded-[12px] border border-[var(--line)] bg-panel px-5 py-4 shadow-[0_1px_2px_rgba(23,25,27,0.04)]">
        {children}
      </div>
    </section>
  )
}
