'use client';

import { hashBlobSha256 } from './sha256';
import { getLocalFolderSession } from '../local/local-folder-session';
import { writeLocalFile, type LocalDirectoryHandle } from '../local/local-folder-storage';

interface StoredLocalAsset { key: string; blob: Blob; name: string; mime: string; size: number }
const hashPattern = /^[a-f0-9]{64}$/;
async function assetDirectory(knowledgeBaseId: string, create = false) {
  return getLocalFolderSession().getDirectory(knowledgeBaseId).getDirectoryHandle('assets', { create });
}

/** The document stores asset:<sha256>; original bytes and metadata live in its chosen folder. */
export async function saveLocalAsset(knowledgeBaseId: string, file: File, onProgress?: (ratio: number) => void): Promise<string> {
  const hash = await hashBlobSha256(file, { onProgress }), directory = await assetDirectory(knowledgeBaseId, true);
  await writeLocalFile(directory, hash, file);
  await writeLocalFile(directory, `${hash}.json`, JSON.stringify({ name: file.name, mime: file.type || 'application/octet-stream', size: file.size }));
  return `asset:${hash}`;
}
export async function readLocalAsset(knowledgeBaseId: string, source: string): Promise<StoredLocalAsset | null> {
  const hash = source.startsWith('asset:') ? source.slice(6) : '';
  if (!hashPattern.test(hash)) return null;
  try {
    const directory = await assetDirectory(knowledgeBaseId);
    const [blob, text] = await Promise.all([(await directory.getFileHandle(hash)).getFile(), (await directory.getFileHandle(`${hash}.json`)).getFile().then(file => file.text())]);
    const metadata = JSON.parse(text) as { name?: unknown; mime?: unknown; size?: unknown };
    if (typeof metadata.name !== 'string' || typeof metadata.mime !== 'string' || metadata.size !== blob.size) throw new Error('Invalid local asset metadata');
    return { key: `${knowledgeBaseId}:${hash}`, blob: blob.slice(0, blob.size, metadata.mime), name: metadata.name, mime: metadata.mime, size: blob.size };
  } catch (cause) { if (cause instanceof DOMException && cause.name === 'NotFoundError') return null; throw cause; }
}
export async function listLocalKnowledgeBaseAssets(knowledgeBaseId: string): Promise<StoredLocalAsset[]> {
  let directory: LocalDirectoryHandle;
  try { directory = await assetDirectory(knowledgeBaseId) as LocalDirectoryHandle; }
  catch (cause) { if (cause instanceof DOMException && cause.name === 'NotFoundError') return []; throw cause; }
  const assets: StoredLocalAsset[] = [];
  for await (const [name, entry] of directory.entries()) if (entry.kind === 'file' && hashPattern.test(name)) {
    const asset = await readLocalAsset(knowledgeBaseId, `asset:${name}`);
    if (!asset) throw new Error('Local attachment is missing');
    assets.push(asset);
  }
  return assets;
}
