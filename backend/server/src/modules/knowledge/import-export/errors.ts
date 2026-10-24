export type VaultErrorCode =
  /** 压缩包不是可解析的 zip,或包含非法条目(绝对路径、`..`、反斜杠、超限)。 */
  | 'VAULT_ARCHIVE_INVALID'
  /** 页面与附件在 vault 内的路径互相冲突,目录树无法自洽。 */
  | 'VAULT_TREE_INVALID'
  /** 发起者对导出根(或导入目标父页)没有所需权限。 */
  | 'VAULT_ACCESS_DENIED'
  /** 导入目标 knowledgeBase/teamspace/父页面不存在或已回收。 */
  | 'VAULT_TARGET_INVALID'
  /** 附件与 AS01 存储交互失败(上传/确认/下载)。 */
  | 'VAULT_STORAGE_FAILED';

/** 整体失败(包损坏、权限拒绝等);逐页/逐附件失败不抛出,进汇总报告。 */
export class KnowledgeVaultError extends Error {
  constructor(readonly code: VaultErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = 'KnowledgeVaultError';
  }
}
