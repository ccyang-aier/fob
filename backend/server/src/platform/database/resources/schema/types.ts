import { Buffer } from 'node:buffer';
import { customType, timestamp } from 'drizzle-orm/pg-core';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** pg returns bytea as Buffer; Yjs consumes the Uint8Array interface. */
export const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

export const ltree = customType<{ data: string; driverData: string }>({
  dataType: () => 'ltree',
});

/** Dimensionless storage permits rebuilding with a different embedding model. */
export const embeddingVector = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector',
  toDriver: (value) => {
    if (!value.length || value.some((entry) => !Number.isFinite(entry))) {
      throw new TypeError('An embedding must contain finite numbers');
    }
    return `[${value.join(',')}]`;
  },
  fromDriver: (value) => JSON.parse(value) as number[],
});

export const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
