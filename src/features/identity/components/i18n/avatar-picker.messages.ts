import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  title: ['更换头像','Change avatar'], close: ['关闭头像选择','Close avatar picker'],
  upload: ['上传头像','Upload photo'], uploadHint: ['JPG、PNG、WebP，最大 5 MB','JPG, PNG, WebP, up to 5 MB'],
  processing: ['正在处理图片…','Preparing image…'], use: ['使用此头像','Use avatar'], cancel: ['取消','Cancel'], clear: ['使用默认头像','Use default avatar'],
  pets: ['萌宠','Little companions'], sketches: ['简笔画','Illustrations'], landscapes: ['风景','Landscapes'],
  preset: ['{family}头像 {number}','{family} avatar {number}'], selected: ['当前选择','Selected avatar'],
  type: ['请选择 JPG、PNG 或 WebP 图片','Choose a JPG, PNG or WebP image'],
  size: ['图片大小需在 5 MB 以内','Choose an image under 5 MB'], decode: ['无法处理这张图片，请换一张重试','Could not process this image. Try a different one.'],
  failed: ['头像保存失败，请重试','Could not save avatar. Try again.'],
});
