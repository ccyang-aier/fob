import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  changeIcon: ['更改图标', 'Change icon'],
  setCover: ['设置封面', 'Set cover'],
  valueForValue: ['「{v0}」的{v1}。', '{v1} for “{v0}”.'],
  theIconAppearsInThePageTreeAnd: [
    '图标显示在页面树与引用处',
    'The icon appears in the page tree and references',
  ],
  theCoverAppearsAtTheTopOfThe: ['封面显示在页面顶部', 'The cover appears at the top of the page'],
  cancel: ['取消', 'Cancel'],
  apply: ['应用', 'Apply'],
  iconPicker: ['图标选择', 'Icon picker'],
  noIcon: ['无图标', 'No icon'],
  coverImageUrl: ['封面图片地址', 'Cover image URL'],
  coverMustUseAnHttpSImageUrl: [
    '封面必须是 http(s) 图片地址。',
    'Cover must use an http(s) image URL.',
  ],
  coverPreview: ['封面预览', 'Cover preview'],
  leaveEmptyAndApplyToRemoveTheCover: [
    '留空并应用即可移除当前封面；上传与裁剪随附件任务接入。',
    'Leave empty and apply to remove the cover. Uploading and cropping are not available yet.',
  ],
});
