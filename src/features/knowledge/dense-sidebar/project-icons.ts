import { Archive, Biology, BookOpen, BookOpenText, CalendarDots, Camera, ClockCounterClockwise, Cloud, Code, Cooking, Database, Desktop, FileText, Finance, Fitness, Flask, Folder, Function, Globe, GraduationCap, Hardware, Image, MusicNotes, Orbit, Palette, PencilSimple, Plant, Reasoning, Robot, ShieldCheck, Translate, Travel } from '@/components/icons';

export const PROJECT_ICON_CATALOG = [
  { id: "folder", icon: Folder, labels: { en: "Folder", zh: "普通知识库" } },
  { id: "document", icon: FileText, labels: { en: "Document", zh: "文档" } },
  { id: "notebook", icon: BookOpen, labels: { en: "Notebook", zh: "笔记" } },
  { id: "collection", icon: Archive, labels: { en: "Collection", zh: "资料集" } },
  { id: "canvas", icon: Palette, labels: { en: "Canvas", zh: "画布" } },
  { id: "calendar", icon: CalendarDots, labels: { en: "Calendar", zh: "日历" } },
  { id: "gardening", icon: Plant, labels: { en: "Gardening", zh: "园艺" } },
  { id: "image", icon: Image, labels: { en: "Images", zh: "图片" } },
  { id: "chinese", icon: Translate, labels: { en: "Chinese", zh: "语文" } },
  { id: "mathematics", icon: Function, labels: { en: "Mathematics", zh: "数学" } },
  { id: "english", icon: Translate, labels: { en: "English", zh: "英语" } },
  { id: "physics", icon: Orbit, labels: { en: "Physics", zh: "物理" } },
  { id: "chemistry", icon: Flask, labels: { en: "Chemistry", zh: "化学" } },
  { id: "biology", icon: Biology, labels: { en: "Biology", zh: "生物" } },
  { id: "history", icon: ClockCounterClockwise, labels: { en: "History", zh: "历史" } },
  { id: "geography", icon: Globe, labels: { en: "Geography", zh: "地理" } },
  { id: "reading", icon: BookOpenText, labels: { en: "Reading", zh: "阅读" } },
  { id: "writing", icon: PencilSimple, labels: { en: "Writing", zh: "写作" } },
  { id: "photography", icon: Camera, labels: { en: "Photography", zh: "摄影" } },
  { id: "music", icon: MusicNotes, labels: { en: "Music", zh: "音乐" } },
  { id: "cooking", icon: Cooking, labels: { en: "Cooking", zh: "烹饪" } },
  { id: "fitness", icon: Fitness, labels: { en: "Fitness", zh: "健身" } },
  { id: "travel", icon: Travel, labels: { en: "Travel", zh: "旅行" } },
  { id: "finance", icon: Finance, labels: { en: "Finance", zh: "财务" } },
  { id: "ai", icon: Robot, labels: { en: "Artificial intelligence", zh: "人工智能" } },
  { id: "reasoning", icon: Reasoning, labels: { en: "Reasoning", zh: "推理" } },
  { id: "training", icon: GraduationCap, labels: { en: "Training", zh: "训练" } },
  { id: "coding", icon: Code, labels: { en: "Coding", zh: "编程" } },
  { id: "computer", icon: Desktop, labels: { en: "Computer", zh: "计算机" } },
  { id: "hardware", icon: Hardware, labels: { en: "Hardware", zh: "硬件" } },
  { id: "robotics", icon: Robot, labels: { en: "Robotics", zh: "机器人" } },
  { id: "data", icon: Database, labels: { en: "Data", zh: "数据" } },
  { id: "cloud", icon: Cloud, labels: { en: "Cloud services", zh: "云服务" } },
  { id: "security", icon: ShieldCheck, labels: { en: "Security", zh: "网络安全" } },
] as const;

export type ProjectIconDefinition = (typeof PROJECT_ICON_CATALOG)[number];
export type ProjectIconId = ProjectIconDefinition["id"];

export const DEFAULT_PROJECT_ICON_ID: ProjectIconId = "folder";

const PROJECT_ICON_BY_ID = new Map<string, ProjectIconDefinition>(
  PROJECT_ICON_CATALOG.map((icon) => [icon.id, icon]),
);

export function isProjectIconId(value: unknown): value is ProjectIconId {
  return typeof value === "string" && PROJECT_ICON_BY_ID.has(value);
}

export function getProjectIconDefinition(iconId?: string): ProjectIconDefinition {
  return PROJECT_ICON_BY_ID.get(iconId ?? "") ?? PROJECT_ICON_CATALOG[0];
}
