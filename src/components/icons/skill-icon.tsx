import type { SVGProps } from 'react';

export function SkillIcon({ size = 16, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="m14 3 7 4v8l-11 6-7-4V9l11-6Z" />
    <path d="m3 9 7 4 11-6M3 13l7 4 11-6M10 13v8" />
  </svg>;
}
