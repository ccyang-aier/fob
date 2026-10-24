import type { AttributeSpec } from '@tiptap/pm/model';

export const nullableString: AttributeSpec = { default: null, validate: 'string|null' };
export const stringAttribute: AttributeSpec = { default: '', validate: 'string' };

export function integerAttribute(defaultValue: number, min = 0, max = Number.MAX_SAFE_INTEGER): AttributeSpec {
  return {
    default: defaultValue,
    validate(value: unknown) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new RangeError(`Expected an integer between ${min} and ${max}`);
      }
    },
  };
}

export const nullableObject: AttributeSpec = {
  default: null,
  validate(value: unknown) {
    if (value === null) return;
    if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a plain JSON object or null');
    validateJsonValue(value, new Set());
  },
};

/** Reject values JSON.stringify would coerce, omit, execute, or fail to serialize. */
function validateJsonValue(value: unknown, ancestors: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object') throw new TypeError('Expected a JSON value');
  if (ancestors.has(value)) throw new TypeError('JSON values cannot contain cycles');

  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Expected a plain JSON object or array');
  }
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (array && keys.length !== value.length + 1) throw new TypeError('JSON arrays must be dense and have no extra properties');
  for (const key of keys) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string' || (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) {
      throw new TypeError('JSON values cannot contain symbol keys or array properties');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('JSON properties must be enumerable data values');
    }
    validateJsonValue(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}
