import test from "node:test";
import assert from "node:assert/strict";
import { submitNightAction, resolveNight } from "../src/game/night.js";

function game() {
 return { phase:"night", stateVersion:1, actions:{}, players:[
  {id:"d",role:"doctor",faction:"city",alive:true,health:100,armor:0},
  {id:"m",role:"boss",faction:"mafia",alive:true,health:100,armor:0},
  {id:"c",role:"citizen",faction:"city",alive:true,health:100,armor:0},
  {id:"c2",role:"citizen",faction:"city",alive:true,health:100,armor:0}
 ]};
}
test("doctor protection prevents a night elimination",()=>{
 const g=game(); submitNightAction(g,"d","protect","c"); submitNightAction(g,"m","attack","c");
 const result=resolveNight(g); assert.deepEqual(result.deaths,[]); assert.equal(g.players[2].alive,true);
});
test("a role cannot submit an action it does not own",()=>{
 assert.throws(()=>submitNightAction(game(),"c","attack","m"),/cannot perform/);
});
test("night actions are one-per-action and resolve to day",()=>{
 const g=game(); submitNightAction(g,"m","attack","c");
 assert.throws(()=>submitNightAction(g,"m","attack","d"),/already submitted/);
 const result=resolveNight(g); assert.deepEqual(result.deaths,["c"]); assert.equal(g.phase,"day");
});

test("mafia coordinates one shared attack instead of killing multiple targets",()=>{
 const g={phase:"night",stateVersion:0,actions:{},players:[
  {id:"b",role:"boss",faction:"mafia",alive:true,health:100,armor:0},
  {id:"k",role:"killer",faction:"mafia",alive:true,health:100,armor:0},
  {id:"c",role:"citizen",faction:"city",alive:true,health:100,armor:0},
  {id:"d",role:"doctor",faction:"city",alive:true,health:100,armor:0},
  {id:"s",role:"survivor",faction:"independent",alive:true,health:100,armor:0}
 ]};
 submitNightAction(g,"b","attack","c");
 submitNightAction(g,"k","attack","c");
 const result=resolveNight(g);
 assert.deepEqual(result.deaths,["c"]);
 assert.equal(g.players.find(p=>p.id==="d").alive,true);
});
