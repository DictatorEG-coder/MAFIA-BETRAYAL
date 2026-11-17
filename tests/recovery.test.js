import test from "node:test";
import assert from "node:assert/strict";
import { RoomCoordinator } from "../src/room/room-object.js";

function makeContext() {
  const data = new Map();
  let alarm = null;
  return {
    storage: {
      get: async key => data.get(key),
      put: async (key, value) => data.set(key, structuredClone(value)),
      setAlarm: async value => { alarm = value; },
      getAlarm: async () => alarm
    }
  };
}

test("room coordinator persists a deadline and schedules a durable alarm", async () => {
  const ctx = makeContext();
  const room = new RoomCoordinator(ctx, {});
  const joined = await room.fetch(new Request("https://room/join", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chatId: "-1001", actor: { id: "42", name: "Player" } })
  }));
  assert.equal(joined.status, 200);
  const deadline = Date.now() + 60_000;
  const scheduled = await room.fetch(new Request("https://room/schedule", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ deadline })
  }));
  assert.equal(scheduled.status, 200);
  assert.equal(await ctx.storage.getAlarm(), deadline);
  assert.equal((await ctx.storage.get("room")).deadline, deadline);
});
