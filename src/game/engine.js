import { assignRoles, ROLE_FACTIONS } from "./roles.js";
import { resolveVote } from "./voting.js";
import { getWinner } from "./win-conditions.js";

export function createGame(playerIds, random = Math.random, now = Date.now()) {
  const roles = assignRoles(playerIds, random);
  const players = Object.entries(roles).map(([id, role]) => ({
    id, role, faction: ROLE_FACTIONS[role], alive: true, health: 100, armor: 0
  }));
  return {
    id: crypto.randomUUID(), phase: "night", round: 1, stateVersion: 1,
    startedAt: now, players, votes: {}, actions: {}, winner: null, endedAt: null
  };
}

export function castVote(game, voterId, targetId) {
  if (game.phase !== "voting") throw new Error("Voting is not open");
  const voter = game.players.find(p => p.id === String(voterId) && p.alive);
  const target = game.players.find(p => p.id === String(targetId) && p.alive);
  if (!voter || !target || voter.id === target.id) throw new Error("Invalid vote");
  if (game.votes[voter.id]) throw new Error("Vote already submitted");
  game.votes[voter.id] = target.id;
  game.stateVersion++;
  return game;
}

export function finishVoting(game) {
  if (game.phase !== "voting") throw new Error("Voting is not open");
  const alive = game.players.filter(p => p.alive).map(p => p.id);
  const result = resolveVote(game.votes, alive);
  if (result.eliminated) {
    const player = game.players.find(p => p.id === result.eliminated);
    player.alive = false;
    player.health = 0;
  }
  game.phase = "night";
  game.round++;
  game.votes = {};
  game.winner = getWinner(game.players, game.round - 1);
  if (game.winner) {
    game.phase = "ended";
    game.endedAt = Date.now();
  }
  game.stateVersion++;
  return { game, result };
}
