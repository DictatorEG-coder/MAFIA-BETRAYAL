import test from "node:test";
import assert from "node:assert/strict";
import { nominate, selectDefendant } from "../src/game/day.js";
test("nomination forbids self nomination and duplicate nominations",()=>{
 const g={phase:"day",stateVersion:0,players:[{id:"a",alive:true},{id:"b",alive:true}],nominations:{}};
 assert.throws(()=>nominate(g,"a","a"),/Invalid nomination/);
 nominate(g,"a","b");
 assert.throws(()=>nominate(g,"a","b"),/Already nominated/);
});
test("most nominated player becomes defendant",()=>{
 const g={phase:"nomination",stateVersion:0,players:[{id:"a",alive:true},{id:"b",alive:true},{id:"c",alive:true}],nominations:{a:"c",b:"c"}};
 assert.equal(selectDefendant(g).defendant,"c");
 assert.equal(g.phase,"defense");
});
