import test from "node:test";
import assert from "node:assert/strict";
import { purchase } from "../src/game/economy.js";

test("purchase deducts the room-local balance", () => {
  assert.deepEqual(purchase(500, "armor"), { ok: true, balance: 350, item: "armor", quantity: 1, total: 150 });
});
test("purchase cannot overdraw", () => {
  assert.equal(purchase(100, "armor").reason, "insufficient_funds");
});
test("unknown products are rejected", () => {
  assert.throws(() => purchase(500, "role_reveal"));
});
