import {
  Article,
  Bicycle,
  BookOpen,
  BookmarkSimple,
  Briefcase,
  CalendarBlank,
  Camera,
  ChartBar,
  CheckCircle,
  Cloud,
  Code,
  Compass,
  Database,
  Envelope,
  FileText,
  Flag,
  Flask,
  Folder,
  Globe,
  GraduationCap,
  Hash,
  Heart,
  House,
  Image,
  Lightbulb,
  Lightning,
  Lock,
  MusicNote,
  Palette,
  Rocket,
  Star,
  Target,
  Terminal,
  Tree,
  Trophy,
  Users,
  type Icon,
} from '@phosphor-icons/react';

export const pageIconColors = [
  '#526175',
  '#0863d1',
  '#20b9eb',
  '#9955e8',
  '#ff845e',
  '#ee5684',
  '#ecae12',
  '#2bc4b6',
  '#09ac7b',
  '#d940e8',
  '#303a33',
] as const;
export { pageEmojis, pageEmojiGroups } from './page-emojis';
export const pageIcons: {
  id: string;
  label: { zh: string; en: string };
  keywords: string;
  glyph: Icon;
}[] = [
  {
    id: 'graduation-cap',
    label: { zh: '学士帽', en: 'Education' },
    keywords: '学士帽 Education',
    glyph: GraduationCap,
  },
  {
    id: 'bicycle',
    label: { zh: '自行车', en: 'Bicycle' },
    keywords: '自行车 Bicycle',
    glyph: Bicycle,
  },
  { id: 'flask', label: { zh: '实验', en: 'Flask' }, keywords: '实验 Flask', glyph: Flask },
  { id: 'folder', label: { zh: '文件夹', en: 'Folder' }, keywords: '文件夹 Folder', glyph: Folder },
  {
    id: 'bookmark',
    label: { zh: '书签', en: 'Bookmark' },
    keywords: '书签 Bookmark',
    glyph: BookmarkSimple,
  },
  {
    id: 'calendar',
    label: { zh: '日历', en: 'Calendar' },
    keywords: '日历 Calendar',
    glyph: CalendarBlank,
  },
  { id: 'book', label: { zh: '书籍', en: 'Book' }, keywords: '书籍 Book', glyph: BookOpen },
  { id: 'camera', label: { zh: '相机', en: 'Camera' }, keywords: '相机 Camera', glyph: Camera },
  {
    id: 'compass',
    label: { zh: '指南针', en: 'Compass' },
    keywords: '指南针 Compass',
    glyph: Compass,
  },
  { id: 'cloud', label: { zh: '云', en: 'Cloud' }, keywords: '云 Cloud', glyph: Cloud },
  { id: 'code', label: { zh: '代码', en: 'Code' }, keywords: '代码 Code', glyph: Code },
  {
    id: 'database',
    label: { zh: '数据库', en: 'Database' },
    keywords: '数据库 Database',
    glyph: Database,
  },
  { id: 'check', label: { zh: '完成', en: 'Check' }, keywords: '完成 Check', glyph: CheckCircle },
  {
    id: 'envelope',
    label: { zh: '邮件', en: 'Envelope' },
    keywords: '邮件 Envelope',
    glyph: Envelope,
  },
  { id: 'article', label: { zh: '文章', en: 'Article' }, keywords: '文章 Article', glyph: Article },
  {
    id: 'lightbulb',
    label: { zh: '灵感', en: 'Lightbulb' },
    keywords: '灵感 Lightbulb',
    glyph: Lightbulb,
  },
  { id: 'chart', label: { zh: '图表', en: 'Chart' }, keywords: '图表 Chart', glyph: ChartBar },
  { id: 'globe', label: { zh: '地球', en: 'Globe' }, keywords: '地球 Globe', glyph: Globe },
  { id: 'hash', label: { zh: '话题', en: 'Hash' }, keywords: '话题 Hash', glyph: Hash },
  { id: 'users', label: { zh: '团队', en: 'Users' }, keywords: '团队 Users', glyph: Users },
  { id: 'image', label: { zh: '图片', en: 'Image' }, keywords: '图片 Image', glyph: Image },
  {
    id: 'lightning',
    label: { zh: '闪电', en: 'Lightning' },
    keywords: '闪电 Lightning',
    glyph: Lightning,
  },
  { id: 'music', label: { zh: '音乐', en: 'Music' }, keywords: '音乐 Music', glyph: MusicNote },
  { id: 'lock', label: { zh: '安全', en: 'Lock' }, keywords: '安全 Lock', glyph: Lock },
  { id: 'palette', label: { zh: '设计', en: 'Palette' }, keywords: '设计 Palette', glyph: Palette },
  { id: 'rocket', label: { zh: '火箭', en: 'Rocket' }, keywords: '火箭 Rocket', glyph: Rocket },
  { id: 'target', label: { zh: '目标', en: 'Target' }, keywords: '目标 Target', glyph: Target },
  { id: 'star', label: { zh: '星星', en: 'Star' }, keywords: '星星 Star', glyph: Star },
  { id: 'heart', label: { zh: '喜欢', en: 'Heart' }, keywords: '喜欢 Heart', glyph: Heart },
  { id: 'house', label: { zh: '主页', en: 'House' }, keywords: '主页 House', glyph: House },
  {
    id: 'briefcase',
    label: { zh: '工作', en: 'Briefcase' },
    keywords: '工作 Briefcase',
    glyph: Briefcase,
  },
  {
    id: 'terminal',
    label: { zh: '终端', en: 'Terminal' },
    keywords: '终端 Terminal',
    glyph: Terminal,
  },
  { id: 'tree', label: { zh: '树木', en: 'Tree' }, keywords: '树木 Tree', glyph: Tree },
  { id: 'flag', label: { zh: '旗帜', en: 'Flag' }, keywords: '旗帜 Flag', glyph: Flag },
  { id: 'trophy', label: { zh: '奖杯', en: 'Trophy' }, keywords: '奖杯 Trophy', glyph: Trophy },
  { id: 'file', label: { zh: '文档', en: 'File' }, keywords: '文档 File', glyph: FileText },
];
/** Page metadata holds either an emoji or a named glyph with a literal RGB color. */
export function encodePageIcon(id: string, color: string) {
  if (!pageIcons.some((icon) => icon.id === id) || !/^#[0-9a-f]{6}$/i.test(color))
    throw new Error('Invalid page icon');
  return `glyph:${id}:${color.toLowerCase()}`;
}
export function decodePageIcon(value: string | null | undefined) {
  const match = /^glyph:([a-z-]+):(#[0-9a-f]{6})$/i.exec(value ?? '');
  const icon = match && pageIcons.find((icon) => icon.id === match[1]);
  return icon && match ? { ...icon, color: match[2] } : null;
}
export function PageIcon({
  value,
  size = 16,
  className,
}: {
  value?: string | null;
  size?: number;
  className?: string;
}) {
  const icon = decodePageIcon(value);
  if (icon) {
    const Glyph = icon.glyph;
    return (
      <Glyph
        aria-hidden
        size={size}
        weight="fill"
        className={className}
        style={{ color: icon.color }}
        data-page-icon={value}
      />
    );
  }
  if (value && !value.startsWith('glyph:'))
    return (
      <span
        aria-hidden
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          flexShrink: 0,
          fontSize: size,
          lineHeight: 1,
        }}
        data-page-icon={value}
      >
        {value}
      </span>
    );
  return <FileText aria-hidden size={size} weight="fill" className={className} />;
}
