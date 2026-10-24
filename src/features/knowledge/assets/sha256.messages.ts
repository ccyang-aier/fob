import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  sha256CannotUpdateAfterDigesthex: [
    'sha256: digestHex 已终结,不能再 update',
    'sha256: cannot update after digestHex',
  ],
  sha256DigesthexCanOnlyBeCalledOnce: [
    'sha256: digestHex 只能调用一次',
    'sha256: digestHex can only be called once',
  ],
});
