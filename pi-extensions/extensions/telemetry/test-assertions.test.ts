import assert from "node:assert/strict";
import test from "node:test";
import { expect } from "./test-assertions.ts";

test("not.toEqual compares plain objects independently of their prototypes", () => {
  const nullPrototypeObject = Object.assign(Object.create(null), { value: 1 });
  const ordinaryObject = { value: 1 };

  assert.throws(() => expect(nullPrototypeObject).not.toEqual(ordinaryObject));
  expect(Object.assign(Object.create(null), { value: 2 })).not.toEqual(ordinaryObject);
});
