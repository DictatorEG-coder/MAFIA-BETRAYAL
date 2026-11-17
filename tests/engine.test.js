import test from "node:test";
import assert from "node:assert/strict";
import { createGame, castVote } from "../src/game/engine.js";

test("game initializes with private roles and stable player state", () => {
  const game = createGame(["1","2","3","4","5"], () => 0.1);
  assert.equal(game.players.length, 5);
  assert.equal(game.phase, "night");
  assert.ok(game.players.every(p => p.health === 100 && p.alive));
});
test("votes are phase-gated and cannot be submitted twice", () => {
  const game = createGame(["1","2","3","4","5"], () => 0.1);
  assert.throws(() => castVote(game, "1", "2"), /Voting is not open/);
  game.phase = "voting";
  castVote(game, "1", "2");
  assert.throws(() => castVote(game, "1", "3"), /already submitted/);
});
