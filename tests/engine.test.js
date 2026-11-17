import test from "node:test";
import assert from "node:assert/strict";
import { createGame, castVote, avenge } from "../src/game/engine.js";

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
  game.defendant = "2";
  castVote(game, "1", "2");
  assert.throws(() => castVote(game, "1", "3"), /already submitted/);
});

test("secret ballot accepts votes only for the selected defendant",()=>{
 const game=createGame(["1","2","3","4","5"],()=>0.2);
 game.phase="voting"; game.defendant="2";
 assert.throws(()=>castVote(game,"1","3"),/accused player/);
 assert.throws(()=>castVote(game,"2","2"),/Invalid vote/);
 castVote(game,"1","2");
 assert.equal(game.votes["1"],"2");
});

test("avenger can eliminate one target only after being eliminated",()=>{
 const game={phase:"day",round:2,stateVersion:1,players:[
  {id:"a",role:"avenger",faction:"city",alive:false,health:0},
  {id:"m",role:"boss",faction:"mafia",alive:true,health:100},
  {id:"c",role:"citizen",faction:"city",alive:true,health:100},
  {id:"d",role:"doctor",faction:"city",alive:true,health:100},
  {id:"s",role:"survivor",faction:"independent",alive:true,health:100}
 ]};
 assert.throws(()=>avenge(game,"c","m"),/must be eliminated/);
 assert.equal(avenge(game,"a","m").targetId,"m");
 assert.equal(game.players.find(p=>p.id==="m").alive,false);
 assert.throws(()=>avenge(game,"a","c"),/already used/);
});
