import { OutlineCollectionIcon } from '@/components/icons';
import { PageIcon } from '../navigation/page-icon';

/** Folder and collection rows share the same artwork and optical size. */
export function DocumentListIcon({ value }: { value?: string | null }) {
  return value ? <PageIcon value={value} size={26} /> : <OutlineCollectionIcon name="document" />;
}
