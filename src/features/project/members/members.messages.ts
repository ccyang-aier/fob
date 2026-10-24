import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  title: ['团队', 'Team'], members: ['成员', 'Members'], structure: ['团队结构', 'Team structure'],
  comingSoon: ['暂未开发', 'Not yet available'], add: ['新增成员', 'New member'],
  search: ['搜索成员', 'Search members'], searchPlaceholder: ['搜索姓名、部门或标签', 'Search name, department or label'],
  clearSearch: ['清除搜索', 'Clear search'], labels: ['标签', 'Labels'], allLabels: ['全部标签', 'All labels'],
  filterLabel: ['标签：{name}', 'Label: {name}'], searchLabels: ['搜索标签', 'Search labels'], noLabelsFound: ['没有匹配的标签', 'No matching labels'],
  clearLabelFilter: ['清除标签筛选“{name}”', 'Clear label filter “{name}”'],
  addLabel: ['添加标签', 'Add label'], labelInput: ['搜索或输入新标签', 'Search or enter a new label'],
  reuseLabel: ['添加标签“{name}”', 'Add label “{name}”'], removeLabel: ['移除标签“{name}”', 'Remove label “{name}”'],
  pinLabel: ['置顶标签“{name}”', 'Pin label “{name}”'], unpinLabel: ['取消置顶标签“{name}”', 'Unpin label “{name}”'],
  pinnedLabel: ['置顶标签：{name}', 'Pinned label: {name}'], pinHint: ['置顶标签优先展示', 'Pinned labels appear first'],
  noLabels: ['未添加标签', 'No labels'],
  name: ['姓名', 'Name'], position: ['职位', 'Position'], department: ['部门', 'Department'], joined: ['加入时间', 'Joined'], email: ['邮箱', 'Email'], phone: ['电话', 'Phone'],
  grid: ['成员卡片', 'Member cards'], list: ['成员列表', 'Member list'], open: ['查看 {name}', 'View {name}'], details: ['成员详情', 'Member details'],
  close: ['关闭', 'Close'], cancel: ['取消', 'Cancel'], save: ['保存更改', 'Save changes'],
  remove: ['移除成员', 'Remove member'], removeTitle: ['移除这位示例成员？', 'Remove this preview member?'], removeDescription: ['此操作将从当前示例目录中移除 {name}。', 'This will remove {name} from this preview directory.'],
  added: ['已添加到示例目录', 'Added to the preview directory'], saved: ['示例资料已更新', 'Preview profile updated'], removed: ['已从示例目录移除', 'Removed from the preview directory'],
  noMatches: ['没有匹配的成员', 'No matching members'], clearFilters: ['清除筛选', 'Clear filters'], empty: ['暂无成员', 'No members yet'],
  count: ['{count} 位成员', '{count} members'],
});
