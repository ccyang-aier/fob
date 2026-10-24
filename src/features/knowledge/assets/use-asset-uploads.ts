'use client';

/**
 * React 绑定(U08):`useAssetUploads` 持有一个上传控制器实例并经
 * useSyncExternalStore 订阅其不可变快照。控制器在首个渲染惰性创建并保持
 * 引用稳定 —— 注入的端口(api/transfer/hashFile)按引用捕获,调用方传稳定
 * 引用(模块级工厂或 useRef),不要内联字面量。
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { createAssetUploadStore, createBrowserAssetUploadPorts } from './upload-machine';
import type { AssetUploadItem, AssetUploadStore, UploadedAsset } from './upload-machine';
import { knowledgeAssetsApi } from './assets-api';
import { xhrAssetTransfer } from './transfer';

export type { UploadedAsset } from './upload-machine';

export interface UseAssetUploadsOptions {
  knowledgeBaseId: string;
  /** 上传完成(含秒传)时回调;编辑器在此插入 `asset:<hash>` 媒体块。 */
  onUploaded?: (asset: UploadedAsset) => void;
  /** 以下端口仅供测试注入;浏览器装配使用默认 XHR + tRPC 实现。 */
  api?: typeof knowledgeAssetsApi;
  transfer?: typeof xhrAssetTransfer;
}

export interface UseAssetUploads {
  items: readonly AssetUploadItem[];
  addFiles: (files: Iterable<File>) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
}

export function useAssetUploads(options: UseAssetUploadsOptions): UseAssetUploads {
  const { knowledgeBaseId } = options;
  const store = useMemo<AssetUploadStore>(() => {
    const api = options.api ?? knowledgeAssetsApi;
    const transfer = options.transfer ?? xhrAssetTransfer;
    const ports = createBrowserAssetUploadPorts(api, transfer);
    return createAssetUploadStore({ knowledgeBaseId, ports, onUploaded: options.onUploaded });
    // 端口与完成回调按引用捕获一次:knowledgeBaseId 变化即新知识库,需新控制器;
    // 回调请传稳定引用(useCallback/模块级),与注入端口同一契约。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knowledgeBaseId]);

  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.getItems(), [store]);

  return {
    items: useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
    addFiles: useCallback((files: Iterable<File>) => store.addFiles(files), [store]),
    cancel: useCallback((id: string) => store.cancel(id), [store]),
    retry: useCallback((id: string) => store.retry(id), [store]),
    remove: useCallback((id: string) => store.remove(id), [store]),
    clearFinished: useCallback(() => store.clearFinished(), [store]),
  };
}
