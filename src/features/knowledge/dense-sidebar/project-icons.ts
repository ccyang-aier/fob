export const PROJECT_ICON_CATALOG = [
  { id: "folder", fileName: "01-folder.png", labels: { en: "Folder", zh: "普通知识库" } },
  { id: "document", fileName: "02-document.png", labels: { en: "Document", zh: "文档" } },
  { id: "notebook", fileName: "03-notebook.png", labels: { en: "Notebook", zh: "笔记" } },
  { id: "collection", fileName: "04-collection.png", labels: { en: "Collection", zh: "资料集" } },
  { id: "canvas", fileName: "31-canvas.png", labels: { en: "Canvas", zh: "画布" } },
  { id: "calendar", fileName: "32-calendar.png", labels: { en: "Calendar", zh: "日历" } },
  { id: "gardening", fileName: "33-gardening.png", labels: { en: "Gardening", zh: "园艺" } },
  { id: "image", fileName: "34-image.png", labels: { en: "Images", zh: "图片" } },
  { id: "chinese", fileName: "05-chinese.png", labels: { en: "Chinese", zh: "语文" } },
  { id: "mathematics", fileName: "06-mathematics.png", labels: { en: "Mathematics", zh: "数学" } },
  { id: "english", fileName: "07-english.png", labels: { en: "English", zh: "英语" } },
  { id: "physics", fileName: "08-physics.png", labels: { en: "Physics", zh: "物理" } },
  { id: "chemistry", fileName: "09-chemistry.png", labels: { en: "Chemistry", zh: "化学" } },
  { id: "biology", fileName: "10-biology.png", labels: { en: "Biology", zh: "生物" } },
  { id: "history", fileName: "11-history.png", labels: { en: "History", zh: "历史" } },
  { id: "geography", fileName: "12-geography.png", labels: { en: "Geography", zh: "地理" } },
  { id: "reading", fileName: "13-reading.png", labels: { en: "Reading", zh: "阅读" } },
  { id: "writing", fileName: "14-writing.png", labels: { en: "Writing", zh: "写作" } },
  { id: "photography", fileName: "15-photography.png", labels: { en: "Photography", zh: "摄影" } },
  { id: "music", fileName: "16-music.png", labels: { en: "Music", zh: "音乐" } },
  { id: "cooking", fileName: "17-cooking.png", labels: { en: "Cooking", zh: "烹饪" } },
  { id: "fitness", fileName: "18-fitness.png", labels: { en: "Fitness", zh: "健身" } },
  { id: "travel", fileName: "19-travel.png", labels: { en: "Travel", zh: "旅行" } },
  { id: "finance", fileName: "20-finance.png", labels: { en: "Finance", zh: "财务" } },
  { id: "ai", fileName: "21-ai.png", labels: { en: "Artificial intelligence", zh: "人工智能" } },
  { id: "reasoning", fileName: "22-reasoning.png", labels: { en: "Reasoning", zh: "推理" } },
  { id: "training", fileName: "23-training.png", labels: { en: "Training", zh: "训练" } },
  { id: "coding", fileName: "24-coding.png", labels: { en: "Coding", zh: "编程" } },
  { id: "computer", fileName: "25-computer.png", labels: { en: "Computer", zh: "计算机" } },
  { id: "hardware", fileName: "26-hardware.png", labels: { en: "Hardware", zh: "硬件" } },
  { id: "robotics", fileName: "27-robotics.png", labels: { en: "Robotics", zh: "机器人" } },
  { id: "data", fileName: "28-data.png", labels: { en: "Data", zh: "数据" } },
  { id: "cloud", fileName: "29-cloud.png", labels: { en: "Cloud services", zh: "云服务" } },
  { id: "security", fileName: "30-security.png", labels: { en: "Security", zh: "网络安全" } },
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

export function getProjectIconUrl(iconId?: string): string {
  return `/assets/project-icons/${getProjectIconDefinition(iconId).fileName}`;
}
