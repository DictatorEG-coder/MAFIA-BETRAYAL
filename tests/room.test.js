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
 const response=await call(room,"/start",{});
 assert.equal(response.status,400);
 assert.equal((await response.json()).error,"player_count");
});
test("lobby prepares private chats and starts with secret role assignments",async()=>{
 const room=makeRoom();
 for(let i=1;i<=5;i++) await call(room,"/join",{chatId:"-100",actor:{id:String(i),name:"P"+i}});
 const prepared=await call(room,"/prepare",{});
 assert.equal(prepared.status,200);
 assert.equal((await prepared.json()).players.length,5);
 const started=await call(room,"/start",{});
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
 await call(room,"/start",{});
 const again=await call(room,"/start",{});
 assert.equal(again.status,409);
});
