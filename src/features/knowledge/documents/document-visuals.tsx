import { FileText, FolderOpen } from '@/components/icons';
import { PageIcon } from '../navigation/page-icon';
import styles from './documents-page.module.css';
export function formatOf(title: string) { return title.includes('.') ? title.split('.').at(-1)!.toUpperCase() : 'DOC'; }
export function FileBadge({ title, icon }: {
    title: string;
    icon?: string | null;
}) {
    if (icon) return <span className={styles.fileBadge} style={{ background: 'var(--surface-subtle)' }}><PageIcon value={icon} size={20} /></span>;
    const format = formatOf(title);
    const color = ({ PDF: '#ef4544', DOCX: '#3864ff', DOC: '#3864ff', XLSX: '#13a447', PPTX: '#ff9f08', FIG: '#7252ff' } as Record<string, string>)[format] ?? '#71829e';
    return <span className={styles.fileBadge} style={{ background: color }} aria-hidden="true">{format === 'PDF' ? <FileText size={16}/> : format === 'XLSX' ? 'X' : format === 'PPTX' ? 'P' : format === 'FIG' ? 'F' : format === 'DOCX' ? 'W' : <FileText size={16}/>}</span>;
}
export function FolderArtwork({ index }: { index: number }) {
    return <FolderOpen size={96} className={styles.folderArt} data-folder-artwork={index} aria-hidden />;
}
