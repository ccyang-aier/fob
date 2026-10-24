import { UserAvatar } from '@/components/user-avatar';
import styles from './comments.module.css';

export type CommentAuthor = { name: string; image?: string | null };

export function CommentAvatar({ author }: { author?: CommentAuthor }) {
  return <UserAvatar name={author?.name} image={author?.image} className={styles.avatar} />;
}
