import Image from 'next/image';
import type { HTMLAttributes } from 'react';
import { findEmoji } from './emoji-catalog';
import { resolveIconSize } from './metrics';

/** Fob's reviewed local OpenMoji subset; existing unsupported Unicode remains readable. */
export function Emoji({ value, size = 24, style, ...props }: HTMLAttributes<HTMLSpanElement> & { value: string; size?: number }) {
  const entry = findEmoji(value);
  const dimension = Number(resolveIconSize(size));
  return <span aria-hidden {...props} data-emoji={value} data-icon-library={entry ? 'openmoji' : 'native-emoji'} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: dimension, height: dimension, fontSize: dimension, lineHeight: 1, verticalAlign: 'middle', ...style }}>
    {entry ? <Image src={`/icons/openmoji/${entry.hexcode}.svg`} alt="" width={dimension} height={dimension} unoptimized draggable={false} style={{ display: 'block', width: dimension, height: dimension }} /> : value}
  </span>;
}
