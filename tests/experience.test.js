import test from "node:test";
import assert from "node:assert/strict";
import { resolveNight, submitNightAction } from "../src/game/night.js";
import { appendPublicEvent, getPublicHistory, getGameStats } from "../src/game/experience.js";

test("doctor receives private confirmation when protection saves the target",()=>{
  const game={phase:"night",round:1,stateVersion:1,winner:null,actions:{},players:[
    {id:"doctor",role:"doctor",faction:"city",alive:true,health:100,armor:0},
    {id:"boss",role:"boss",faction:"mafia",alive:true,health:100,armor:0},
    {id:"citizen",role:"citizen",faction:"city",alive:true,health:100,armor:0}
  ]};
  submitNightAction(game,"doctor","protect","citizen");
  submitNightAction(game,"boss","attack","citizen");
  const result=resolveNight(game);
  const report=result.actionReports.find(item=>item.actorId==="doctor");
  assert.match(report.text,/نجحت حمايتك/);
  assert.deepEqual(result.deaths,[]);
  assert.equal(result.actionReports.some(item=>item.targetId),false);
});

test("mafia receives a private failure notice when its selected target is protected",()=>{
  const game={phase:"night",round:1,stateVersion:1,winner:null,actions:{},players:[
    {id:"doctor",role:"doctor",faction:"city",alive:true,health:100,armor:0},
    {id:"boss",role:"boss",faction:"mafia",alive:true,health:100,armor:0},
    {id:"citizen",role:"citizen",faction:"city",alive:true,health:100,armor:0}
  ]};
  submitNightAction(game,"doctor","protect","citizen");
  submitNightAction(game,"boss","attack","citizen");
  const result=resolveNight(game);
  const report=result.actionReports.find(item=>item.actorId==="boss");
  assert.match(report.text,/لم ينجح الهجوم/);
  assert.equal(result.deaths.length,0);
});

test("public history contains only authored public event text and current match statistics",()=>{
  const game={round:2,phase:"day",players:[{alive:true},{alive:false},{alive:true}],votes:{a:"b"},abstentions:{c:true},history:[]};
  appendPublicEvent(game,{phase:"day",text:"بدأ النهار."});
  assert.deepEqual(getPublicHistory(game),[{round:2,phase:"day",text:"بدأ النهار."}]);
  assert.deepEqual(getGameStats(game),{rounds:2,players:3,survivors:2,eliminated:1,votes:1,abstentions:1,events:1});
});
