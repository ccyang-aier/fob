/**
 * U08 浏览器哈希上传与进度控制 · 公共出口。
 *
 * 上传面板:`AssetUploader`(拖拽/点选、进度、取消/重试/错误反馈);
 * 完成回调 `onUploaded` 是编辑器插入 `asset:<hash>` 媒体块的挂点。
 * 纯逻辑层(哈希、API 面、控制器、传输端口)也从此处导出,便于宿主
 * 以外的装配(如导入器)复用同一闭环。
 */

export { AssetUploader } from './components/asset-uploader';
export { UploadQueueItem } from './components/upload-queue-item';
export { useAssetUploads } from './use-asset-uploads';
export type { UseAssetUploads, UseAssetUploadsOptions } from './use-asset-uploads';
export { createKnowledgeAssetsApi, knowledgeAssetsApi } from './assets-api';
export type { AssetIntentInput, KnowledgeAssetsApi } from './assets-api';
export {
  assetMaxBytes, createAssetUploadStore, createBrowserAssetUploadPorts,
} from './upload-machine';
export type {
  AssetUploadErrorCode, AssetUploadItem, AssetUploadPhase, AssetUploadPorts, AssetUploadStore, UploadedAsset,
} from './upload-machine';
export { createSha256, hashBlobSha256 } from './sha256';
export { AssetTransferError, xhrAssetTransfer } from './transfer';
export type { AssetTransfer, AssetTransferErrorKind, AssetTransferInput } from './transfer';
export { formatBytes, uploadErrorCopy, uploadPhaseView, uploadRetryHint } from './upload-copy';
export type { UploadPhaseView } from './upload-copy';
