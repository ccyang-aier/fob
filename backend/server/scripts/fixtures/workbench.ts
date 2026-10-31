/** Explicit development fixtures. They are never generated for production users. */
export const developmentId = (category: number, index: number) => `${category.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const definitions = [
  ['产品资料', 28, 101], ['设计规范', 18, 102], ['工程手册', 9, 103], ['新产品探索', 0, 104],
  ['研究笔记', 20, 201], ['学习资料', 7, 202], ['灵感收集', 0, 203],
  ['团队知识', 32, 301], ['客户项目资料', 16, 302], ['市场与运营', 11, 303], ['入职指南', 4, 304], ['待整理资料', 0, 305],
] as const;
const extensions = ['pdf', 'docx', 'xlsx', 'pptx', 'fig', 'md', 'txt', 'csv', 'json', 'html', 'png', 'docx'];
const names = ['需求说明', '项目路线图', '功能清单', '季度规划', '界面设计规范', '接口说明', '会议纪要', '调研数据', '配置示例', '竞品分析', '流程示意', '团队协作指南'];
const creators = ['张三', '李四', '王五', '赵六', '陈七'];
const sources = ['local-upload', 'figma', 'feishu', 'wechat-work', 'dingtalk'] as const;
const folderNames = ['产品设计', '项目资料', '团队规范', '研究报告'];

export function createDevelopmentKnowledgeBases() {
  return definitions.map(([name, count, serial], baseIndex) => {
    const id = developmentId(0x20000000, serial);
    const folders = count > 0 ? folderNames.slice(0, count > 15 ? 4 : 2).map((folderName, index) => ({
      id: developmentId(0x30000000, serial * 10 + index), knowledgeBaseId: id, name: folderName,
    })) : [];
    const documents = Array.from({ length: count }, (_, index) => {
      const title = `${name} · ${names[index % names.length]}${index >= names.length ? ` ${Math.floor(index / names.length) + 1}` : ''}.${extensions[index % extensions.length]}`;
      return {
        id: developmentId(0x40000000, serial * 1000 + index), knowledgeBaseId: id, folderId: folders[index % folders.length].id,
        title, creator: creators[index % creators.length], source: sources[index % sources.length],
        indexStatus: index % 11 === 10 ? 'failed' : index % 9 === 8 ? 'indexing' : 'indexed',
        starred: index % 7 === 0, draft: index % 13 === 12, deleted: false,
        updatedAt: new Date(Date.UTC(2026, 8, 27, 14, 30) - (baseIndex * 20 + index) * 3_600_000).toISOString(),
        body: { type: 'doc', content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: title }] },
          { type: 'paragraph', content: [{ type: 'text', text: `${name}的示例预览内容。用于演示资料整理、搜索、筛选和团队协作。` }] },
          { type: 'paragraph', content: [{ type: 'text', text: `所属知识库：${name}。资料访问由知识库成员关系及文档权限决定。` }] },
        ] },
      };
    });
    return { id, name, folders, documents };
  });
}
