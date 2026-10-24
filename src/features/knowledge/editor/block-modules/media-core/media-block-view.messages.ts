import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  chooseImageFile: ['请选择图片文件', 'Choose an image file'],
  chooseVideoFile: ['请选择视频文件', 'Choose a video file'],
  chooseAudioFile: ['请选择音频文件', 'Choose an audio file'],
  file: ['文件', 'File'],
  add: ['添加', 'Add'],
  cancel: ['取消', 'Cancel'],
  retry: ['重试', 'Retry'],
  image: ['图片', 'Image'],
  video: ['视频', 'Video'],
  audio: ['音频', 'Audio'],
  localAssetNotFoundTheBrowserMayHave: [
    '本机资源不存在，可能已被浏览器清理',
    'Local asset not found. The browser may have removed it.',
  ],
  unableToReadLocalAsset: ['无法读取本机资源', 'Unable to read local asset'],
  unableToReadTeamAssetCheckPermissionsOr: [
    '无法读取团队资源，请检查权限或存储服务。',
    'Unable to read team asset. Check permissions or storage service.',
  ],
  assetUrlIsUnsafeOrInvalid: ['资源地址不安全或格式无效', 'Asset URL is unsafe or invalid'],
  thisAssetIsNotConnectedToAnAccessible: [
    '此资源尚未连接可访问的存储服务',
    'This asset is not connected to an accessible storage service',
  ],
  documentIsNotConnectedToAssetStorage: [
    '文档尚未连接资源存储。',
    'Document is not connected to asset storage.',
  ],
  choose: ['请选择', 'Choose'],
  unableToSaveFile: ['文件保存失败', 'Unable to save file'],
  choose2: ['选择', 'Choose'],
  loading: ['正在加载', 'Loading'],
  open: ['打开', 'Open'],
  replace: ['更换', 'Replace'],
  saving: ['正在保存', 'Saving'],
  uploadCancelled: ['上传已取消', 'Upload cancelled'],
  caption: ['说明', 'Caption'],
  addCaption: ['添加说明…', 'Add caption…'],
});
