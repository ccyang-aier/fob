import { defineMessages } from '@/lib/i18n/messages';

export const messages = defineMessages({
  '未在 PATH 中找到「{0}」命令': [
    '未在 PATH 中找到「{0}」命令',
    'Command “{0}” was not found in PATH',
  ],
  '测试失败：{0}': ['测试失败：{0}', 'Connection test failed: {0}'],
  '登记失败：{0}': ['登记失败：{0}', 'Registration failed: {0}'],
  全部: ['全部', 'All'],
  可用: ['可用', 'Available'],
  不可用: ['不可用', 'Unavailable'],
  'Agent 纳管': ['Agent 纳管', 'Agent management'],
  '管理本机可用的 AI Agent —— {0} 个已登记实例 / {1} 种受支持产品。': [
    '管理本机可用的 AI Agent —— {0} 个已登记实例 / {1} 种受支持产品。',
    'Manage local AI agents — {0} registered instances / {1} supported products.',
  ],
  '搜索 Agent…': ['搜索 Agent…', 'Search agents…'],
  '搜索 Agent': ['搜索 Agent', 'Search agents'],
  刷新发现: ['刷新发现', 'Refresh discovery'],
  '登记 Agent 路径': ['登记 Agent 路径', 'Register agent path'],
  全部受支持产品均已登记: ['全部受支持产品均已登记', 'All supported products are registered'],
  按可用性筛选: ['按可用性筛选', 'Filter by availability'],
  '没有匹配「': ['没有匹配「', 'No agents match “'],
  '」的 Agent': ['」的 Agent', '”'],
  加载中: ['加载中', 'Loading'],
  '正在加载 Agent 目录…': ['正在加载 Agent 目录…', 'Loading agent catalog…'],
  无法连接后端服务: ['无法连接后端服务', 'Unable to connect to the backend'],
  '请启动设备服务后重试。': ['请启动设备服务后重试。', 'Start the device service and try again.'],
  重试连接: ['重试连接', 'Retry connection'],
});
