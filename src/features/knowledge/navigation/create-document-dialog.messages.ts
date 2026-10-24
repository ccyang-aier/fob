import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  newDocument: ['新建文档', 'New document'],
  cancel: ['取消', 'Cancel'],
  creating: ['创建中…', 'Creating…'],
  createDocument: ['创建文档', 'Create document'],
  documentName: ['文档名称', 'Document name'],
  captureTextImagesAndRichContent: [
    '用于记录文字、图片与丰富的内容。',
    'Capture text, images and rich content.',
  ],
  documentPermissions: ['文档权限', 'Document permissions'],
  inheritParentPermissions: ['继承上级权限', 'Inherit parent permissions'],
  useMemberGrantsAndDefaultAccessFromThe: [
    '使用父页面或文件夹的成员授权与默认权限。',
    'Use member grants and default access from the parent page or folder.',
  ],
  independentPermissions: ['独立授权', 'Independent permissions'],
  theCreatorKeepsFullControlOtherMembersNeed: [
    '创建者保留完全控制，其他成员需单独授权。',
    'The creator keeps full control. Other members need explicit grants.',
  ],
  unableToCreateCheckTheErrorAndRetry: [
    '创建失败，请检查错误提示后重试。',
    'Unable to create. Check the error and retry.',
  ],
});
