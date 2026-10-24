import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  knowledgeServiceRejectedSynchronizationTheLocalCopyIs: [
    '同步连接被知识服务拒绝，正文以本地副本展示并暂不可编辑；重新进入页面或恢复访问权限后再试。',
    'Knowledge service rejected synchronization. The local copy is shown and editing is temporarily disabled. Reopen the page or restore access and retry.',
  ],
  readOnlyYourAccessLevelIsCommentYou: [
    '只读模式：你在此页面的访问级别为「评论」，可以阅读与评论，但不能直接编辑正文。',
    'Read only: your access level is Comment. You can read and comment but cannot edit the content.',
  ],
  readOnlyYourAccessLevelIsValueYou: [
    '只读模式：你在此页面的访问级别为「{v0}」，可以阅读但不能修改正文。',
    'Read only: your access level is {v0}. You can read but cannot edit the content.',
  ],
  openingDocument: ['正在打开文档', 'Opening document'],
  establishingDocumentSession: ['正在建立页面文档会话。', 'Establishing document session.'],
  readingLocalCopy: ['正在读取本地副本', 'Reading local copy'],
  restoringTheOfflineLocalCopyBeforeConnectingTo: [
    '正在从本机离线副本恢复页面，随后连接知识服务。',
    'Restoring the offline local copy before connecting to knowledge service.',
  ],
  savedLocally: ['已保存在本机', 'Saved locally'],
  theLocalCopyIsReadyConnectingToKnowledge: [
    '本地副本已就绪；正在准备连接知识服务，编辑会先落在本地。',
    'The local copy is ready. Connecting to knowledge service; edits are saved locally first.',
  ],
  syncing: ['正在同步', 'Syncing'],
  exchangingDocumentUpdatesWithKnowledgeService: [
    '正在与知识服务交换文档更新。',
    'Exchanging document updates with knowledge service.',
  ],
  synced: ['已同步', 'Synced'],
  allChangesAreSyncedToKnowledgeService: [
    '所有更改都已同步到知识服务。',
    'All changes are synced to knowledge service.',
  ],
  offlineEditing: ['离线可编辑', 'Offline editing'],
  disconnectedChangesAreSavedLocallyAndWillMerge: [
    '连接已断开；更改继续保存在本地副本，重连后自动合并。',
    'Disconnected. Changes are saved locally and will merge automatically after reconnection.',
  ],
  syncRejected: ['同步被拒绝', 'Sync rejected'],
  knowledgeServiceRejectedSynchronizationForThisPageValue: [
    '知识服务拒绝了本页的同步连接（{v0}）。正文以本地副本展示。',
    'Knowledge service rejected synchronization for this page ({v0}). The local copy is shown.',
  ],
  knowledgeServiceRejectedSynchronizationForThisPageThe: [
    '知识服务拒绝了本页的同步连接。正文以本地副本展示。',
    'Knowledge service rejected synchronization for this page. The local copy is shown.',
  ],
  view: ['查看', 'View'],
  comments: ['评论', 'Comment'],
  edit: ['编辑', 'Edit'],
  fullAccess: ['完全访问', 'Full access'],
});
