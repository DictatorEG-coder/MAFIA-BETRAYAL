import test from "node:test";
import assert from "node:assert/strict";
import { transition } from "../src/game/state-machine.js";
test("phase transition increments version and records timestamp", () => {
 const next = transition({ phase: "night", stateVersion: 3 }, "day", 1234);
 assert.equal(next.phase, "day"); assert.equal(next.stateVersion, 4); assert.equal(next.phaseStartedAt, 1234);
});
test("invalid transitions are rejected", () => { assert.throws(() => transition({ phase: "ended" }, "night"), /Invalid phase transition/); });