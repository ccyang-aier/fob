import { useId } from 'react';
import { FileText } from '@phosphor-icons/react';
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
    return <span className={styles.fileBadge} style={{ background: color }} aria-hidden="true">{format === 'PDF' ? <FileText size={17} weight="bold"/> : format === 'XLSX' ? 'X' : format === 'PPTX' ? 'P' : format === 'FIG' ? 'F' : format === 'DOCX' ? 'W' : <FileText size={16}/>}</span>;
}
export function FolderArtwork({ index }: {
    index: number;
}) {
    const id = useId().replaceAll(':', '');
    return <svg className={styles.folderArt} viewBox="0 0 180 130" aria-hidden="true">
    <defs><linearGradient id={`${id}back`} x2="0" y2="1"><stop stopColor="#696b6b"/><stop offset="1" stopColor="#484a49"/></linearGradient><linearGradient id={`${id}front`} x2=".7" y2="1"><stop stopColor="#797b79"/><stop offset=".5" stopColor="#646663"/><stop offset="1" stopColor="#595c58"/></linearGradient><filter id={`${id}shadow`} x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="5" stdDeviation="4" floodOpacity=".13"/></filter></defs>
    <g filter={`url(#${id}shadow)`}><rect x="20" y="14" width="140" height="100" rx="15" fill={`url(#${id}back)`} stroke="#929492" strokeWidth=".8"/>
    {index % 2 === 0 ? <g fill="#f3f4f2" stroke="#d5d7d3"><rect x="34" y="21" width="53" height="73" rx="5" transform="rotate(-7 34 21)"/><rect x="78" y="22" width="60" height="72" rx="5" transform="rotate(12 78 22)"/><rect x="49" y="29" width="46" height="65" rx="4"/><path d="M53 34h16v18H53zM108 39h10v12h-10z" fill="none"/></g> : null}
    <path d="M20 48Q20 35 33 35H62Q69 35 74 39L86 45H146Q160 45 160 59V104Q160 117 146 117H34Q20 117 20 104Z" fill={`url(#${id}front)`} stroke="#a2a4a0" strokeWidth=".9"/>
    <circle cx="42" cy="98" r="11" fill="white"/>{index % 4 === 0 ? <g><circle cx="39" cy="92" r="3" fill="#f24e1e"/><circle cx="45" cy="92" r="3" fill="#ff7262"/><circle cx="39" cy="98" r="3" fill="#a259ff"/><circle cx="45" cy="98" r="3" fill="#1abcfe"/><circle cx="39" cy="104" r="3" fill="#0acf83"/></g> : <><rect x="35" y="91" width="14" height="14" rx="3" fill={index % 4 === 3 ? '#e54946' : index % 4 === 1 ? '#202322' : '#3864ff'}/><text x="42" y="102" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">{index % 4 === 1 ? 'N' : index % 4 === 2 ? 'W' : 'P'}</text></>}
    {index % 4 !== 3 ? <><circle cx="69" cy="98" r="11" fill="white"/><path d="m69 90 7 13H62Z" fill="#f3bb25"/><path d="m69 90-7 13h5l5-9Z" fill="#20a66d"/><path d="m62 103 3-5h10l3 5Z" fill="#4285f4"/></> : null}</g>
  </svg>;
}
