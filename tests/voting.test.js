import test from "node:test";
import assert from "node:assert/strict";
import { resolveVote } from "../src/game/voting.js";

test("strict majority eliminates a player", () => {
  const result = resolveVote({ a: "d", b: "d", c: "d", d: "a" }, ["a","b","c","d"]);
  assert.equal(result.eliminated, "d");
});
test("tie does not eliminate", () => {
  const result = resolveVote({ a: "c", b: "d", c: "d", d: "c" }, ["a","b","c","d"]);
  assert.equal(result.reason, "tie");
  assert.equal(result.eliminated, null);
});
test("self votes and invalid voters are ignored", () => {
  const result = resolveVote({ a: "a", outsider: "b" }, ["a","b"]);
  assert.equal(result.eliminated, null);
});
