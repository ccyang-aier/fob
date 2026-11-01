import { BellSimple, CommentOutline, FileText, ThumbsUp } from '@/components/icons';

export const activityKinds = {
  created: { Icon: FileText, label: 'activityCreated' },
  commented: { Icon: CommentOutline, label: 'activityCommented' },
  liked: { Icon: ThumbsUp, label: 'activityLiked' },
  subscribed: { Icon: BellSimple, label: 'activitySubscribed' },
} as const;
