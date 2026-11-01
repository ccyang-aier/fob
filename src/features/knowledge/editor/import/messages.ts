import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  title: ['导入到当前文档', 'Import into this document'],
  hint: ['选择文件或拖入此处，内容将插入当前光标位置。', 'Choose or drop files to insert their content at the current cursor.'],
  choose: ['选择文件', 'Choose files'],
  done: ['内容已导入当前文档', 'Content imported into this document'],
  unavailable: ['当前文档已不可编辑，内容未导入。', 'This document is no longer editable. Nothing was imported.'],
  unsupported: ['请选择支持的文档格式。', 'Choose a supported document format.'],
  tooLarge: ['文本文件最大 1 MB，其他文件最大 100 MB。', 'Text files can be up to 1 MB; other files up to 100 MB.'],
  failed: ['导入失败，请检查文件后重试。', 'Import failed. Check the files and retry.'],
});
