import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  unableToLoadVersionPreviewPleaseRetry: [
    '版本预览加载失败，请重试。',
    'Unable to load version preview. Please retry.',
  ],
  namedVersionSaved: ['已保存为命名版本。', 'Named version saved.'],
  contentMatchesTheLatestVersionThatVersionHas: [
    '内容与最新版本一致，已为该版本命名。',
    'Content matches the latest version. That version has been named.',
  ],
  nameMustContain1200Characters: [
    '命名失败：内容为空或超过 200 字符。',
    'Name must contain 1–200 characters.',
  ],
  thisVersionCouldNotBeParsedOrRestored: [
    '该版本内容无法解析，未能恢复。',
    'This version could not be parsed or restored.',
  ],
  versionRestoredUndoCtrlZToReturnTo: [
    '已恢复该版本，可通过撤销(Ctrl+Z)回到恢复前状态。',
    'Version restored. Undo (Ctrl+Z) to return to the previous content.',
  ],
  pageVersionHistory: ['页面历史版本', 'Page version history'],
  versionHistory: ['历史版本', 'Version history'],
  nameCurrentVersion: ['命名当前版本', 'Name current version'],
  versionNameEGReviewBaseline: ['版本名,如「评审基线」', 'Version name, e.g. Review baseline'],
  versionName: ['版本名称', 'Version name'],
  save: ['保存', 'Save'],
  cancel: ['取消', 'Cancel'],
  loadingVersions: ['正在加载版本…', 'Loading versions…'],
  versionHistoryIsTemporarilyUnavailable: [
    '历史版本暂时不可用。',
    'Version history is temporarily unavailable.',
  ],
  retry: ['重试', 'Retry'],
  noVersionsYetACheckpointIsSavedAfter: [
    '尚无历史版本;编辑 10 分钟以上或结束会话时会自动生成检查点。',
    'No versions yet. A checkpoint is saved after 10 minutes of editing or when the session ends.',
  ],
  unnamedVersion: ['未命名版本', 'Unnamed version'],
  thisVersionIsEmptyOrCannotBePreviewed: [
    '该版本内容为空或无法预览。',
    'This version is empty or cannot be previewed.',
  ],
  restoringReplacesTheCurrentContentWithASingle: [
    '恢复会以一次可撤销的编辑覆盖当前正文。',
    'Restoring replaces the current content with a single undoable edit.',
  ],
  pageEditingPermissionRequired: ['需要页面编辑权限', 'Page editing permission required'],
  restoreThisVersion: ['恢复此版本', 'Restore this version'],
});
