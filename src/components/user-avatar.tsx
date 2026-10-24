import Image from 'next/image';
import { cn } from '@/lib/utils';
import styles from './user-avatar.module.css';

/** Shared account portrait: use the person's image, otherwise their first initial. */
export function UserAvatar({ name, image, className }: { name?: string; image?: string | null; className?: string }) {
  const initial = Array.from(name?.trim() || '?')[0].toUpperCase();
  return <span className={cn(styles.avatar, className)} data-fallback={!image} aria-hidden>
    {image ? <Image className={styles.image} src={image} alt="" width={32} height={32} unoptimized /> : initial}
  </span>;
}
