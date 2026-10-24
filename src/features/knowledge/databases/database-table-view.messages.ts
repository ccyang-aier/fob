import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  actionFailedPleaseRetry: ['操作失败，请重试。', 'Action failed. Please retry.'],
  valueFailedValueValuePreviousValuesRestored: [
    '{v0}失败{v1}：{v2}已恢复到操作前的值。',
    '{v0} failed{v1}: {v2}Previous values restored.',
  ],
  editCell: ['编辑单元格', 'Edit cell'],
  valueFailedValue: ['{v0}失败：{v1}', '{v0} failed: {v1}'],
  newRow: ['新建行', 'New row'],
  checkingPageAccess: ['正在确认页面访问', 'Checking page access'],
  unableToVerifyPageAccess: ['无法确认页面访问', 'Unable to verify page access'],
  unableToVerifyPageAccessPleaseRetry: [
    '确认页面访问时出现问题，请重试。',
    'Unable to verify page access. Please retry.',
  ],
  youDoNotHaveAccessToThisDatabase: [
    '没有该数据库的访问权限',
    'You do not have access to this database',
  ],
  yourCredentialsCannotViewThisPageContactIts: [
    '当前凭证对这个页面没有查看权限；如果最近权限有调整，请联系页面所有者。',
    'Your credentials cannot view this page. Contact its owner if permissions recently changed.',
  ],
  yourCredentialsCannotReadThisDatabaseContactThe: [
    '当前凭证无法读取这个数据库；如果最近权限有调整，请联系页面所有者。',
    'Your credentials cannot read this database. Contact the page owner if permissions recently changed.',
  ],
  unableToLoadDatabase: ['数据库加载失败', 'Unable to load database'],
  unableToReadDatabasePleaseRetry: [
    '读取数据库时出现问题，请重试。',
    'Unable to read database. Please retry.',
  ],
  databaseServiceEndpointUnavailable: [
    '（数据库服务路由尚未装配）',
    '(Database service endpoint unavailable)',
  ],
  valueTableView: ['{v0} · 表格视图', '{v0} · Table view'],
  database: ['数据库', 'Database'],
  readOnly: ['只读', 'Read only'],
  newRow2: ['新行', 'New row'],
  noRowsMatchTheFilters: ['没有满足筛选的行', 'No rows match the filters'],
  noRowsInThisDatabaseYet: ['这个数据库还没有行', 'No rows in this database yet'],
  adjustOrRemoveFiltersToSeeMoreRows: [
    '调整或移除筛选条件后即可看到更多行。',
    'Adjust or remove filters to see more rows.',
  ],
  eachRowIsAPageCreateARow: [
    '每一行都是一个页面：创建第一行后，点击行名即可打开行正文。',
    'Each row is a page. Create a row, then click its name to open its content.',
  ],
  createFirstRow: ['新建第一行', 'Create first row'],
  renameColumn: ['重命名列', 'Rename column'],
  deleteColumn: ['删除列', 'Delete column'],
  newColumn: ['新建列', 'New column'],
  loadMoreLoaded: ['加载更多（已加载', 'Load more (loaded'],
  rows: ['行）', 'rows)'],
  oneRow: ['行）', 'row)'],
  editOptions: ['编辑选项', 'Edit options'],
  knowledgeServiceUnavailableRetryLater: [
    '知识服务暂时不可用，请稍后重试。',
    'Knowledge service unavailable. Retry later.',
  ],
  unableToConnectToKnowledgeServiceCheckYour: [
    '无法连接知识服务，请检查网络后重试。',
    'Unable to connect to knowledge service. Check your connection and retry.',
  ],
  knowledgeServiceConnectionTimedOutPleaseRetry: [
    '连接知识服务超时，请重试。',
    'Knowledge service connection timed out. Please retry.',
  ],
  tooManyRequestsRetryLater: ['请求过于频繁，请稍后重试。', 'Too many requests. Retry later.'],
  knowledgeServiceAddressIsNotConfigured: [
    '知识服务地址未配置，无法建立连接。',
    'Knowledge service address is not configured.',
  ],
  thisActionRequiresAHigherAccessLevel: [
    '该操作需要更高的访问权限。',
    'This action requires a higher access level.',
  ],
});
