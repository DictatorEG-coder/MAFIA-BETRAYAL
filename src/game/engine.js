import { assignRoles, ROLE_FACTIONS } from "./roles.js";
import { resolveVote } from "./voting.js";
import { getWinner } from "./win-conditions.js";
import { assignGamblerMission, evaluateGamblerMission } from "./gambler.js";

export function createGame(playerIds, random = Math.random, now = Date.now()) {
  const roles = assignRoles(playerIds, random);
  const players = Object.entries(roles).map(([id, role]) => ({
    id, role, faction: ROLE_FACTIONS[role], alive: true, health: 100, armor: 0
  }));
  const gambler=players.find(p=>p.role==="gambler");
  if(gambler) gambler.mission=assignGamblerMission(random);
  return {
    id: crypto.randomUUID(), phase: "night", round: 1, stateVersion: 1,
    startedAt: now, players, votes: {}, actions: {}, winner: null, endedAt: null
  };
}

export function avenge(game, actorId, targetId) {
  const actor=game.players.find(p=>p.id===String(actorId));
  const target=game.players.find(p=>p.id===String(targetId)&&p.alive);
  if(!actor || actor.role!=="avenger" || actor.alive) throw new Error("Avenger must be eliminated before using this ability");
  if(actor.avenged) throw new Error("Avenger ability already used");
  if(!target || target.id===actor.id) throw new Error("Invalid revenge target");
  actor.avenged=true;
  target.alive=false;
  target.health=0;
  game.winner=getWinner(game.players,game.round);
  if(game.winner) { game.phase="ended"; game.endedAt=Date.now(); }
  game.stateVersion++;
  return {targetId:target.id,winner:game.winner};
}

export function castVote(game, voterId, targetId) {
  if (game.phase !== "voting") throw new Error("Voting is not open");
  const voter = game.players.find(p => p.id === String(voterId) && p.alive);
  const target = game.players.find(p => p.id === String(targetId) && p.alive);
  if (!voter || !target || voter.id === target.id) throw new Error("Invalid vote");
  if (game.votes[voter.id]) throw new Error("Vote already submitted");
  if (!game.defendant || target.id !== game.defendant) throw new Error("Votes must target the accused player");
  game.votes[voter.id] = target.id;
  game.stateVersion++;
  return game;
}

export function finishVoting(game) {
  if (game.phase !== "voting") throw new Error("Voting is not open");
  const alive = game.players.filter(p => p.alive).map(p => p.id);
  const previousVotes={...game.votes};
  const previousNominations={...(game.nominations??{})};
  const previousDefendant=game.defendant;
  const result = resolveVote(game.votes, alive);
  if (result.eliminated) {
    const player = game.players.find(p => p.id === result.eliminated);
    player.alive = false;
    player.health = 0;
  }
  const gambler=game.players.find(p=>p.role==="gambler"&&p.alive);
  const gamblerWon=gambler && evaluateGamblerMission(gambler.mission,{
    alive:gambler.alive,
    nominated:previousNominations[gambler.id]===previousDefendant,
    votedForEliminated:Boolean(result.eliminated&&previousVotes[gambler.id]===result.eliminated)
  });
  game.phase = "night";
  game.round++;
  game.votes = {};
  game.nominations = {};
  game.defendant = null;
  if(gamblerWon) game.winner={winner:"gambler",reason:"secret_mission_completed",playerId:gambler.id};
  else if(gambler) gambler.mission=assignGamblerMission(Math.random,gambler.mission);
  game.winner = game.winner ?? getWinner(game.players, game.round - 1);
  if (game.winner) {
    game.phase = "ended";
    game.endedAt = Date.now();
  }
  game.stateVersion++;
  return { game, result };
}
