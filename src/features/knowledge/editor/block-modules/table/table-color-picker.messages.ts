import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  saturationAndBrightness: ['饱和度与亮度', 'Saturation and brightness'],
  saturationValueBrightnessValue: [
    '饱和度 {v0}%，亮度 {v1}%',
    'Saturation {v0}%, brightness {v1}%',
  ],
  hue: ['色相', 'Hue'],
  opacity: ['透明度', 'Opacity'],
  hexColor: ['十六进制颜色', 'Hex color'],
  colorCopied: ['已复制颜色', 'Color copied'],
  copyColor: ['复制颜色', 'Copy color'],
  unableToCopyCopyTheColorValueManually: [
    '复制失败，请手动复制颜色值',
    'Unable to copy. Copy the color value manually.',
  ],
  copyColorValue: ['复制颜色值', 'Copy color value'],
});
