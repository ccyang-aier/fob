/**
 * 资源身份色板：用于头像、字标与资源类型识别，不用于导航、按钮或交互选中态。
 * chip 为软底 + 同族深色图标的容器形态；plain 为裸图标的着色形态。
 */

export const toneChips = {
  teal: "bg-[#dff5ee] text-[#0ba17f]",
  blue: "bg-[#e8f0ff] text-[#3579e7]",
  sky: "bg-[#e5f4fd] text-[#2b95c9]",
  violet: "bg-[#efe9ff] text-[#7856e5]",
  amber: "bg-[#fdf2e3] text-[#c78a2d]",
  rose: "bg-[#fdeef0] text-[#d9536a]",
  indigo: "bg-[#e9edfd] text-[#4f5fd6]",
  slate: "bg-[#eef0f4] text-[#5a6472]",
} as const

export const toneIcons = {
  teal: "text-[#12907a]",
  blue: "text-[#3e6fd9]",
  sky: "text-[#2b95c9]",
  violet: "text-[#7856e5]",
  amber: "text-[#c07f2e]",
  rose: "text-[#d9536a]",
  indigo: "text-[#4f5fd6]",
  slate: "text-[#5a6472]",
} as const

export type IconTone = keyof typeof toneChips
