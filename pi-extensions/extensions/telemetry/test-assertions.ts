import assert from "node:assert/strict";

type Matchers = {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toHaveLength(expected: number): void;
  toContain(expected: unknown): void;
  toMatch(expected: RegExp | string): void;
  toThrow(expected?: RegExp | string): void;
  toBeLessThan(expected: number): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  not: Matchers;
  resolves: { toBeUndefined(): Promise<void> };
  rejects: { toBeDefined(): Promise<void> };
};

/** Small assertion adapter for the existing matcher-style telemetry tests. */
function normalizeForEquality(value: any): any {
  if (Array.isArray(value)) return value.map(normalizeForEquality);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null || prototype === Object.prototype) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeForEquality(item)]));
    }
  }
  return value;
}

export function expect(actual: any): Matchers {
  const matchers = (negated: boolean): Matchers => ({
    toBe(expected) {
      if (negated) assert.notStrictEqual(actual, expected);
      else assert.strictEqual(actual, expected);
    },
    toEqual(expected) {
      const normalizedActual = normalizeForEquality(actual);
      const normalizedExpected = normalizeForEquality(expected);
      if (negated) assert.notDeepStrictEqual(normalizedActual, normalizedExpected);
      else assert.deepStrictEqual(normalizedActual, normalizedExpected);
    },
    toBeDefined() {
      if (negated) assert.strictEqual(actual, undefined);
      else assert.notStrictEqual(actual, undefined);
    },
    toBeUndefined() {
      if (negated) assert.notStrictEqual(actual, undefined);
      else assert.strictEqual(actual, undefined);
    },
    toHaveLength(expected) {
      if (negated) assert.notStrictEqual(actual?.length, expected);
      else assert.strictEqual(actual?.length, expected);
    },
    toContain(expected) {
      const contains = typeof actual === "string"
        ? actual.includes(String(expected))
        : Array.isArray(actual) && actual.includes(expected);
      assert.equal(negated ? !contains : contains, true);
    },
    toMatch(expected) {
      const matches = typeof expected === "string" ? actual.includes(expected) : expected.test(actual);
      assert.equal(negated ? !matches : matches, true);
    },
    toThrow(expected) {
      if (negated) assert.doesNotThrow(actual);
      else {
        let thrown: unknown;
        try {
          actual();
        } catch (error) {
          thrown = error;
        }
        assert.notStrictEqual(thrown, undefined, "Expected function to throw");
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        if (expected instanceof RegExp) assert.match(message, expected);
        else if (typeof expected === "string") assert.ok(message.includes(expected));
      }
    },
    toBeLessThan(expected) {
      assert.equal(negated ? !(actual < expected) : actual < expected, true);
    },
    toBeGreaterThan(expected) {
      assert.equal(negated ? !(actual > expected) : actual > expected, true);
    },
    toBeGreaterThanOrEqual(expected) {
      assert.equal(negated ? !(actual >= expected) : actual >= expected, true);
    },
    get not() {
      return matchers(!negated);
    },
    resolves: {
      async toBeUndefined() {
        const value = await actual;
        assert.strictEqual(value, undefined);
      },
    },
    rejects: {
      async toBeDefined() {
        try {
          await actual;
        } catch (error) {
          assert.notStrictEqual(error, undefined);
          return;
        }
        assert.fail("Expected promise to reject");
      },
    },
  });
  return matchers(false);
}
