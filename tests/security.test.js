import test from "node:test";
import assert from "node:assert/strict";
import { isTelegramId, isValidRoomId } from "../src/security/validation.js";

test("telegram identifiers are validated as decimal strings", () => {
  assert.equal(isTelegramId("123456"), true);
  assert.equal(isTelegramId("-1"), false);
  assert.equal(isTelegramId("abc"), false);
});
test("room ids have a bounded length", () => {
  assert.equal(isValidRoomId("room-1"), true);
  assert.equal(isValidRoomId("x".repeat(129)), false);
});
