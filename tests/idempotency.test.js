import test from "node:test";
import assert from "node:assert/strict";
import { runOnce } from "../src/game/idempotency.js";
function memoryStorage() { const data = new Map(); return { get: async k => data.get(k), put: async (k,v) => data.set(k,v) }; }
test("duplicate action key replays stored result without rerunning operation", async () => {
 const storage = memoryStorage(); let calls = 0;
 const first = await runOnce(storage, "action-123", async () => ++calls);
 const second = await runOnce(storage, "action-123", async () => ++calls);
 assert.equal(first.replayed, false); assert.equal(second.replayed, true); assert.equal(second.value, 1); assert.equal(calls, 1);
});