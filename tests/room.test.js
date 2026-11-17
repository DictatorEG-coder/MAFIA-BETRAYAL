import test from "node:test";
import assert from "node:assert/strict";
import { RoomCoordinator } from "../src/room/room-object.js";

function makeRoom() {
 const values=new Map();
 const ctx={storage:{
  get:async k=>values.get(k),
  put:async(k,v)=>values.set(k,structuredClone(v)),
  setAlarm:async()=>{}
 }};
 return new RoomCoordinator(ctx,{});
}
async function call(room,path,body) {
 return room.fetch(new Request("https://room"+path,{
  method:body?"POST":"GET",
  headers:body?{"content-type":"application/json"}:{},
  body:body?JSON.stringify(body):undefined
 }));
}
test("lobby cannot start below five players",async()=>{
 const room=makeRoom();
 await call(room,"/join",{chatId:"-100",actor:{id:"1",name:"one"}});
 const response=await call(room,"/start",{actorId:"1"});
 assert.equal(response.status,400);
 assert.equal((await response.json()).error,"player_count");
});
test("lobby prepares private chats and starts with secret role assignments",async()=>{
 const room=makeRoom();
 for(let i=1;i<=5;i++) await call(room,"/join",{chatId:"-100",actor:{id:String(i),name:"P"+i}});
 const prepared=await call(room,"/prepare",{actorId:"1"});
 assert.equal(prepared.status,200);
 assert.equal((await prepared.json()).players.length,5);
 const started=await call(room,"/start",{actorId:"1"});
 const data=await started.json();
 assert.equal(started.status,200);
 assert.equal(data.players.length,5);
 assert.equal(new Set(data.players.map(p=>p.role)).size,5);
 const status=await (await call(room,"/status")).json();
 assert.equal(status.status,"playing");
});
test("room refuses a second game start",async()=>{
 const room=makeRoom();
 for(let i=1;i<=5;i++) await call(room,"/join",{chatId:"-100",actor:{id:String(i),name:"P"+i}});
 await call(room,"/start",{actorId:"1"});
 const again=await call(room,"/start",{actorId:"1"});
 assert.equal(again.status,409);
});

test("only the room creator can prepare or start a game",async()=>{
 const room=makeRoom();
 for(let i=1;i<=5;i++) await call(room,"/join",{chatId:"-100",actor:{id:String(i),name:"P"+i}});
 const preflight=await call(room,"/prepare",{actorId:"2"});
 assert.equal(preflight.status,403);
 const start=await call(room,"/start",{actorId:"2"});
 assert.equal(start.status,403);
});

test("room creator can reopen an ended room without losing its roster",async()=>{
 const room=makeRoom();
 await room.ctx.storage.put("room",{chatId:"-100",creatorId:"1",status:"ended",players:{"1":{id:"1",name:"P1"}},game:{phase:"ended"},stateVersion:9});
 const response=await call(room,"/newgame",{actorId:"1"});
 assert.equal(response.status,200);
 const status=await (await call(room,"/status")).json();
 assert.equal(status.status,"lobby");
 assert.equal(status.players,1);
});

test("roles stay hidden from the room until the game ends and private lookup is self-only",async()=>{
 const room=makeRoom();
 for(let i=1;i<=5;i++) await call(room,"/join",{chatId:"-100",actor:{id:String(i),name:"P"+i}});
 await call(room,"/start",{actorId:"1"});
 const publicResult=await call(room,"/result");
 assert.equal(publicResult.status,409);
 const ownRole=await call(room,"/myrole",{actorId:"1"});
 assert.equal(ownRole.status,200);
 assert.ok((await ownRole.json()).role);
 const outsider=await call(room,"/myrole",{actorId:"99"});
 assert.equal(outsider.status,403);
});


test("durable alarm advances the day into nomination after its deadline",async()=>{
 const room=makeRoom();
 await room.ctx.storage.put("room",{
  chatId:"-100",creatorId:"1",status:"playing",
  players:{"1":{id:"1",name:"P1"}},stateVersion:1,
  deadline:Date.now()-1,
  game:{phase:"day",round:1,stateVersion:1,players:[],nominations:{}}
 });
 await room.alarm();
 const state=await room.ctx.storage.get("room");
 assert.equal(state.game.phase,"nomination");
 assert.ok(state.deadline>Date.now());
});
