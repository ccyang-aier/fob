/**
 * 兄弟排序:确定性分数索引(fractional indexing)。
 *
 * 规范形式为「6 位 base-36 整数部分 + 不以 '0' 结尾的小数部分」,字符集 [0-9a-z],
 * 总长 ≤ 256。整数部分定宽保证字典序等于数值序;小数部分去尾零保证同一数值只有
 * 一种表示。字符集刻意排除大写字母:在该子集上 PostgreSQL varchar 排序
 * (C/C.UTF-8 与 glibc/ICU 的 en_US 等)与 JS 代码单元序一致,数据库 `ORDER BY
 * position` 因此与客户端排序同序;混入大小写会在 linguistic collation 下分叉。
 *
 * 中点用 BigInt 有理数精确计算,结果严格落在两边界之间且确定;仅当超过长度上限、
 * 边界重合或输入不是规范形式时抛错,由调用方对兄弟集合做局部重排。
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = 36n;
const INTEGER_DIGITS = 6;
const MAX_LENGTH = 256;
/** 整数部分的值域是 [0, 36^6),约 2.18e9,首位空根两侧各留十亿次增量。 */
const RANGE = BASE ** BigInt(INTEGER_DIGITS);

/** 相邻排序键已无空间(或不是规范形式),调用方应局部重排兄弟集合。 */
export class PositionExhaustedError extends RangeError {
  constructor() {
    super('Sibling position space is exhausted');
    this.name = 'PositionExhaustedError';
  }
}

/** 规范形式的字节序比较;禁止 localeCompare。 */
export function comparePositions(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Scaled {
  /** value = num / 36^scale */
  num: bigint;
  scale: number;
}

const canonical = /^[0-9a-z]{6}(?:[0-9a-z]*[1-9a-z])?$/;

function parse(position: string): Scaled {
  if (position.length < INTEGER_DIGITS || position.length > MAX_LENGTH || !canonical.test(position)) throw new PositionExhaustedError();
  let num = 0n;
  for (const char of position) num = num * BASE + BigInt(ALPHABET.indexOf(char));
  return { num, scale: position.length - INTEGER_DIGITS };
}

function compareScaled(a: Scaled, b: Scaled): number {
  const scale = Math.max(a.scale, b.scale);
  const left = a.num * BASE ** BigInt(scale - a.scale);
  const right = b.num * BASE ** BigInt(scale - b.scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

function format(num: bigint, scale: number): string {
  const divisor = BASE ** BigInt(scale);
  const integer = num / divisor;
  const fraction = (num % divisor).toString(36).padStart(scale, '0').replace(/0+$/, '');
  const position = integer.toString(36).padStart(INTEGER_DIGITS, '0') + fraction;
  if (integer >= RANGE || position.length > MAX_LENGTH) throw new PositionExhaustedError();
  return position;
}

/**
 * 返回严格大于 prev(为 null 视为值域下界 0)、严格小于 next(为 null 视为上界
 * 36^6)的规范排序键。两侧都为 null 时返回值域中点,作为新兄弟集合的首个键。
 */
export function positionBetween(prev: string | null, next: string | null): string {
  const lower = prev === null ? { num: 0n, scale: 0 } satisfies Scaled : parse(prev);
  const upper = next === null ? { num: RANGE, scale: 0 } satisfies Scaled : parse(next);
  if (compareScaled(lower, upper) >= 0) throw new PositionExhaustedError();
  const scale = Math.max(lower.scale, upper.scale);
  const sum = lower.num * BASE ** BigInt(scale - lower.scale) + upper.num * BASE ** BigInt(scale - upper.scale);
  // sum 为奇数时多取一位小数使中点精确,保证严格落在两边界之内。
  return sum % 2n === 0n ? format(sum / 2n, scale) : format((sum * BASE) / 2n, scale + 1);
}

/** 把 count 个键均匀铺满值域,全部为 6 位纯整数形式;局部重排的编号来源。 */
export function distributePositions(count: number): string[] {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('Sibling count must be a nonnegative integer');
  const step = RANGE / BigInt(count + 1);
  return Array.from({ length: count }, (_, index) => format(step * BigInt(index + 1), 0));
}
