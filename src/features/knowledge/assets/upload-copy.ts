import { createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './upload-copy.messages';

/**
 * 上传界面的视图模型(U08):相位 → 文案/进度语义、错误码 → 用户可读副本、
 * 字节数格式化。纯函数,UI 与测试共用同一份映射。
 */

import type { AssetUploadErrorCode, AssetUploadItem } from './upload-machine';

const knowledgeT = createTranslator(knowledgeMessages);

export interface UploadPhaseView {
  label: string;
  /** 按字节计量的相位,进度条显示 progress;否则不确定(indeterminate)。 */
  byteProgress: boolean;
  indeterminate: boolean;
  active: boolean;
}

export function uploadPhaseView(
  item: Pick<AssetUploadItem, 'phase' | 'progress'>,
): UploadPhaseView {
  switch (item.phase) {
    case 'hashing':
      return {
        label: knowledgeT('calculatingSha256'),
        byteProgress: true,
        indeterminate: false,
        active: true,
      };
    case 'preparing':
      return {
        label: knowledgeT('requestingUploadAuthorization'),
        byteProgress: false,
        indeterminate: true,
        active: true,
      };
    case 'uploading':
      return {
        label: knowledgeT('upload'),
        byteProgress: true,
        indeterminate: false,
        active: true,
      };
    case 'confirming':
      return {
        label: knowledgeT('verifyingIntegrity'),
        byteProgress: false,
        indeterminate: true,
        active: true,
      };
    case 'done':
      return {
        label: knowledgeT('ready'),
        byteProgress: false,
        indeterminate: false,
        active: false,
      };
    case 'canceled':
      return {
        label: knowledgeT('cancelled'),
        byteProgress: false,
        indeterminate: false,
        active: false,
      };
    case 'error':
      return {
        label: knowledgeT('failed'),
        byteProgress: false,
        indeterminate: false,
        active: false,
      };
  }
}

function errorCopy(locale?: Locale): Record<AssetUploadErrorCode, string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    FILE_INVALID: knowledgeT('fileDoesNotMeetUploadRequirements'),
    HASH_FAILED: knowledgeT('unableToReadFile'),
    PREPARE_FAILED: knowledgeT('unableToAuthorizeUpload'),
    TRANSFER_NETWORK: knowledgeT('networkInterruptedBeforeUploadCompleted'),
    TRANSFER_REJECTED: knowledgeT('objectStorageRejectedTheUpload'),
    CONFIRM_FAILED: knowledgeT('integrityVerificationFailed'),
  };
}

export function uploadErrorCopy(item: Pick<AssetUploadItem, 'error'>): string | null {
  if (!item.error) return null;
  const base = errorCopy()[item.error.code];
  return item.error.detail ? `${base}(${item.error.detail})` : base;
}

export function uploadRetryHint(item: Pick<AssetUploadItem, 'error'>): string | null {
  if (!item.error) return null;
  switch (item.error.code) {
    case 'CONFIRM_FAILED':
      return knowledgeT('theServerRemovedTheMismatchedObjectRetryTo');
    case 'TRANSFER_REJECTED':
      return knowledgeT('uploadAuthorizationMayHaveExpiredRetryToRequest');
    case 'TRANSFER_NETWORK':
      return knowledgeT('checkYourConnectionAndRetryTheFileFingerprint');
    default:
      return null;
  }
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = size;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
