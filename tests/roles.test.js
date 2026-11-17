import test from "node:test";
import assert from "node:assert/strict";
import { assignRoles } from "../src/game/roles.js";

test("role assignment covers supported lobby sizes without duplicate roles", () => {
  for (let n = 5; n <= 10; n++) {
    const ids = Array.from({ length: n }, (_, i) => String(i + 1));
    const assigned = assignRoles(ids, () => 0.42);
    assert.equal(Object.keys(assigned).length, n);
    assert.equal(new Set(Object.values(assigned)).size, n);
  }
});
test("role assignment rejects unsupported sizes", () => {
  assert.throws(() => assignRoles(["1", "2", "3", "4"]), RangeError);
});
