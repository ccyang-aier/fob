/**
 * 简单的结构化日志器。服务日志输出到进程 stdout/stderr，由运行环境收集。
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const minLevel: Level = (process.env.FOB_LOG_LEVEL as Level) ?? 'info';

function emit(level: Level, tag: string, message: string, extra?: unknown): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  // pid 前缀：桥/垫片子进程与主进程的 stderr 汇入同一日志文件，需可归因
  const line = `[${new Date().toISOString()}] [pid ${process.pid}] [${level}] [${tag}] ${message}`;
  if (extra !== undefined) {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](line, extra);
  } else {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](line);
  }
}

export function createLogger(tag: string) {
  return {
    debug: (message: string, extra?: unknown) => emit('debug', tag, message, extra),
    info: (message: string, extra?: unknown) => emit('info', tag, message, extra),
    warn: (message: string, extra?: unknown) => emit('warn', tag, message, extra),
    error: (message: string, extra?: unknown) => emit('error', tag, message, extra),
  };
}
