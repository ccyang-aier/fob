import Image from 'next/image';

/** Canonical product icon, shared by navigation and account surfaces. */
export function FobMark({ compact = false }: { compact?: boolean }) {
  const size = compact ? 26 : 24;
  return <Image src="/brand/fob-mark.png" alt="" width={size} height={size} draggable={false} className="shrink-0 object-contain" />;
}
