import test from "node:test";
import assert from "node:assert/strict";
import { createGame, castVote, castAbstention, avenge, finishVoting } from "../src/game/engine.js";
import { getWinner } from "../src/game/win-conditions.js";

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

test("gambler receives a rotating secret mission and can win individually",()=>{
 const game={phase:"voting",round:1,stateVersion:1,players:[
  {id:"g",role:"gambler",faction:"independent",alive:true,health:100,mission:"vote"},
  {id:"c",role:"citizen",faction:"city",alive:true,health:100},
  {id:"d",role:"doctor",faction:"city",alive:true,health:100},
  {id:"m",role:"boss",faction:"mafia",alive:true,health:100},
  {id:"s",role:"survivor",faction:"independent",alive:true,health:100}
 ],votes:{g:"m"},nominations:{},defendant:"m"};
 const {game:ended}=finishVoting(game);
 assert.equal(ended.phase,"ended");
 assert.equal(ended.winner.winner,"gambler");
});

test("players can explicitly abstain once and abstention blocks a later vote",()=>{
 const game=createGame(["1","2","3","4","5"],()=>0.2);
 game.phase="voting"; game.defendant="2";
 castAbstention(game,"1");
 assert.equal(game.abstentions["1"],true);
 assert.throws(()=>castAbstention(game,"1"),/already submitted/);
 assert.throws(()=>castVote(game,"1","2"),/already submitted/);
 const completed=finishVoting(game);
 assert.equal(completed.result.reason,"no_valid_votes");
 assert.deepEqual(completed.game.abstentions,{});
});

test("avenger retaliation does not erase an already declared winner",()=>{
 const game={phase:"ended",round:2,stateVersion:1,winner:{winner:"gambler",reason:"secret_mission_completed"},players:[
  {id:"a",role:"avenger",faction:"city",alive:false,health:0},
  {id:"m",role:"boss",faction:"mafia",alive:true,health:100},
  {id:"c",role:"citizen",faction:"city",alive:true,health:100},
  {id:"d",role:"doctor",faction:"city",alive:true,health:100},
  {id:"s",role:"survivor",faction:"independent",alive:true,health:100}
 ]};
 avenge(game,"a","m");
 assert.equal(game.winner.winner,"gambler");
});


test("city wins immediately when every hostile faction has been eliminated",()=>{
 const players=[
  {id:"c",role:"citizen",faction:"city",alive:true},
  {id:"d",role:"doctor",faction:"city",alive:true},
  {id:"s",role:"survivor",faction:"independent",alive:true,hostile:false},
  {id:"m",role:"boss",faction:"mafia",alive:false}
 ];
 assert.deepEqual(getWinner(players,1),{winner:"city",reason:"all_threats_removed"});
});

test("survivor wins after four rounds only while the city has not already eliminated every threat",()=>{
 const players=[
  {id:"c",role:"citizen",faction:"city",alive:true},
  {id:"m",role:"boss",faction:"mafia",alive:true},
  {id:"s",role:"survivor",faction:"independent",alive:true,hostile:false}
 ];
 assert.deepEqual(getWinner(players,4),{winner:"survivor",reason:"survived_four_rounds"});
});
