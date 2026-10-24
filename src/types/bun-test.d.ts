/**
 * Minimal local type surface for 'bun:test'.
 *
 * Frontend tests share this declaration; the backend uses its own @types/bun.
 * Keep the browser program's test API here without importing Bun's runtime
 * globals into production DOM types.
 */
declare module 'bun:test' {
  type TestFn = () => void | Promise<void>
  interface Matchers<T> {
    toBe(expected: unknown): T
    toEqual(expected: unknown): T
    toContain(expected: unknown): T
    toHaveLength(expected: number): T
    toBeNull(): T
    toBeUndefined(): T
    toBeDefined(): T
    toBeTruthy(): T
    toBeFalsy(): T
    toThrow(expected?: string | RegExp | (new (...args: never[]) => Error)): T
    toMatchObject(expected: Record<string, unknown>): T
    toHaveProperty(key: string, value?: unknown): T
    toMatch(pattern: string | RegExp): T
    toBeGreaterThan(expected: number): T
    toBeGreaterThanOrEqual(expected: number): T
    toBeLessThan(expected: number): T
    toBeLessThanOrEqual(expected: number): T
    toBeCloseTo(expected: number, precision?: number): T
    toStartWith(expected: string): T
  }
  interface Expectation<T> extends Matchers<T> {
    not: Matchers<T>
    rejects: Matchers<Promise<T>>
  }
  function describe(name: string, fn: () => void): void
  function test(name: string, fn: TestFn): void
  namespace test {
    function each<T>(cases: readonly T[]): (name: string, fn: (item: T) => void | Promise<void>) => void
  }
  const it: typeof test
  function beforeAll(fn: () => void | Promise<void>, timeout?: number): void
  function afterAll(fn: () => void | Promise<void>): void
  function beforeEach(fn: () => void | Promise<void>): void
  function afterEach(fn: () => void | Promise<void>): void
  function expect<T>(actual: T): Expectation<T>
  type Mock<T extends (...args: never[]) => unknown> = T & {
    mock: { calls: Parameters<T>[] }
    mockClear(): Mock<T>
    mockReset(): Mock<T>
    mockImplementation(implementation: T): Mock<T>
  }
  const mock: {
    <T extends (...args: never[]) => unknown>(implementation: T): Mock<T>
    module(specifier: string, factory: () => Record<string, unknown>): void
    restore(): void
  }
}

/** Bun APIs used by frontend tests, without introducing Bun's production globals. */
declare namespace Bun {
  interface BuildArtifact {
    text(): Promise<string>
  }
  interface BuildOutput {
    success: boolean
    outputs: BuildArtifact[]
  }
  function build(options: { entrypoints: string[]; target: string }): Promise<BuildOutput>
  function sleep(milliseconds: number): Promise<void>
}
