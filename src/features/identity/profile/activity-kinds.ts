import { BellSimple, Chat, FileText, ThumbsUp } from '@/components/icons';

export const activityKinds = {
  created: { Icon: FileText, label: 'activityCreated' },
  commented: { Icon: Chat, label: 'activityCommented' },
  liked: { Icon: ThumbsUp, label: 'activityLiked' },
  subscribed: { Icon: BellSimple, label: 'activitySubscribed' },
} as const;
