import { defineMessages } from '@/lib/i18n';
export const interactionMessages = defineMessages({
  like: ['点赞', 'Like'], unlike: ['取消点赞', 'Unlike'], coffee: ['送咖啡', 'Send coffee'], comments: ['评论', 'Comments'], closeComments: ['收起评论', 'Close comments'],
  selfGift: ['不能给自己送咖啡', 'You cannot send coffee to yourself'], unavailable: ['互动信息暂不可用', 'Interactions unavailable'],
  giftTitle: ['送咖啡', 'Send coffee'], recipient: ['送给 {name}', 'For {name}'], balance: ['可用 {count} 杯', '{count} cups available'],
  quantity: ['咖啡数量', 'Number of coffees'], cups: ['{count} 杯', '{count} cups'], send: ['送出 {count} 杯咖啡', 'Send {count} cups of coffee'],
  insufficient: ['咖啡余额不足', 'Not enough coffee'], loading: ['正在读取余额', 'Loading balance'], balanceFailed: ['无法读取咖啡余额', 'Could not load coffee balance'],
  failed: ['操作失败，请重试', 'Could not complete this action. Please retry'], retry: ['重试', 'Retry'], cancel: ['取消', 'Cancel'],
  sent: ['已向 {name} 送出 {count} 杯咖啡', 'Sent {count} cups of coffee to {name}'],
});
