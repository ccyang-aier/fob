import type { MarkdownNode } from '@fob/shared/knowledge/markdown';
import type { PropertyDefinition, Properties } from '@fob/shared/knowledge/contracts';

/**
 * M04 Notion 导入的共享形状。设计文档 §4.4 只要求导入方向("也能导入 Notion 导出
 * 的内容"),没有 Notion 导出规格,因此本模块只实现导入。所有路径都是导出包内的
 * POSIX 风格相对键(已解码、以 / 分隔),绝不与宿主文件系统语义耦合。
 */

/** 不可映射或被降级映射的元素:逐项显式记录,绝不静默丢弃(验收 3)。 */
export interface NotionImportWarning {
  /** 触发告警的导出内相对路径(页面/数据库/附件)。 */
  readonly source: string;
  readonly code:
    | 'colored_text'
    | 'colored_block'
    | 'toggle_collapsed'
    | 'indent_flattened'
    | 'unsupported_element'
    | 'complex_equation'
    | 'block_anchor_unmapped'
    | 'broken_link'
    | 'skipped_view'
    | 'relation_column_as_text'
    | 'unowned_file';
  readonly detail: string;
}

/** 单项失败(逐项隔离,不中断整体导入);汇总在报告的 failures 数组(验收 4)。 */
export interface NotionImportFailure {
  readonly source: string;
  readonly phase: 'scan' | 'asset' | 'page' | 'database' | 'row' | 'body';
  readonly message: string;
}

export interface NotionImportedPage {
  readonly source: string;
  readonly pageId: string;
  readonly title: string;
  readonly kind: 'doc' | 'database' | 'row';
  readonly parentId: string | null;
  readonly databaseId: string | null;
  readonly bodyPersisted: boolean;
}

export interface NotionImportedDatabase {
  readonly source: string;
  readonly pageId: string;
  readonly title: string;
  readonly columns: readonly PropertyDefinition[];
  readonly rows: number;
}

export interface NotionImportedAsset {
  readonly source: string;
  readonly hash: string;
  readonly mime: string;
  readonly size: number;
  readonly name: string;
}

export interface NotionImportReport {
  readonly pages: readonly NotionImportedPage[];
  readonly databases: readonly NotionImportedDatabase[];
  readonly assets: readonly NotionImportedAsset[];
  readonly warnings: readonly NotionImportWarning[];
  readonly failures: readonly NotionImportFailure[];
}

/** 阶段级进度回调:失败语义与 M03 对齐——逐项反馈,异常永不抛出到回调。 */
export type NotionImportProgress = (event: {
  readonly phase: 'scan' | 'assets' | 'pages';
  readonly completed: number;
  readonly total: number;
  readonly source: string;
}) => void;

/** 导出包扫描结果(纯结构,尚无任何 Fob 身份)。 */
export interface NotionArchivePage {
  readonly key: string;
  /** 文件名去掉 `<32hex>` 后缀得到的标题;HTML 内 page-title 优先于它。 */
  readonly filenameTitle: string;
  readonly format: 'html' | 'markdown';
  /** 扫描两遍后回填:所属目录对应的父页面键;根级为 null。 */
  parentKey: string | null;
}

export interface NotionArchiveDatabase {
  readonly key: string;
  readonly filenameTitle: string;
  parentKey: string | null;
}

export interface NotionArchiveAttachment {
  readonly key: string;
  readonly name: string;
  parentKey: string | null;
}

export interface NotionArchive {
  /** 扫描后生效的导出根目录(可能已越过 Export-<id> 外壳)。 */
  readonly rootDir: string;
  readonly pages: readonly NotionArchivePage[];
  readonly databases: readonly NotionArchiveDatabase[];
  readonly attachments: readonly NotionArchiveAttachment[];
  readonly warnings: readonly NotionImportWarning[];
}

/** HTML/Markdown 解析出的页面正文:mdast 直接喂给 M01 的 fromMdast。 */
export interface NotionParsedPage {
  /** HTML 中的 page-title;Markdown 变体为 null(用文件名标题)。 */
  readonly pageTitle: string | null;
  readonly mdast: MarkdownNode;
  readonly warnings: readonly NotionImportWarning[];
  /** HTML 数据库页检测出的视图表格(见 notion-html 的检测规则);非数据库页为 null。 */
  readonly database: NotionParsedDatabase | null;
}

/** 从 HTML 表格或 CSV 解析出的数据库视图模型。 */
export interface NotionParsedDatabase {
  readonly columns: readonly PropertyDefinition[];
  readonly rows: readonly NotionParsedRow[];
  /** 无法类型化为 relation 的列(Notion 导出不携带目标库信息)。 */
  readonly warnings: readonly NotionImportWarning[];
}

export interface NotionParsedRow {
  readonly title: string;
  readonly properties: Properties;
  /** 行正文对应的导出页面(HTML 变体);CSV 行为 null。 */
  readonly pageKey: string | null;
}
