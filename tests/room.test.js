import test from "node:test";
import assert from "node:assert/strict";
import { RoomCoordinator } from "../src/room/room-object.js";

function makeRoom(env={}) {
 const values=new Map();
 const ctx={storage:{
  get:async k=>values.get(k),
  put:async(k,v)=>values.set(k,structuredClone(v)),
  setAlarm:async()=>{}
 }};
 return new RoomCoordinator(ctx,env);
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

test("only the creator can cancel an active game and cancellation clears its deadline",async()=>{
 const room=makeRoom();
 for(let i=1;i<=5;i++) await call(room,"/join",{chatId:"-100",actor:{id:String(i),name:"P"+i}});
 await call(room,"/start",{actorId:"1"});
 const denied=await call(room,"/cancel",{actorId:"2"});
 assert.equal(denied.status,403);
 const cancelled=await call(room,"/cancel",{actorId:"1"});
 assert.equal(cancelled.status,200);
 const state=await room.ctx.storage.get("room");
 assert.equal(state.status,"ended");
 assert.equal(state.game.phase,"ended");
 assert.equal(state.game.winner.winner,"cancelled");
 assert.equal(state.deadline,null);
 const again=await call(room,"/cancel",{actorId:"1"});
 assert.equal(again.status,409);
});

test("room creator reopens an ended room with an empty roster requiring fresh joins",async()=>{
 const room=makeRoom();
 await room.ctx.storage.put("room",{chatId:"-100",creatorId:"1",status:"ended",players:{"1":{id:"1",name:"P1"}},game:{phase:"ended"},stateVersion:9});
 const response=await call(room,"/newgame",{actorId:"1"});
 assert.equal(response.status,200);
 const status=await (await call(room,"/status")).json();
 assert.equal(status.status,"lobby");
 assert.equal(status.players,0);
 const roster=await (await call(room,"/players")).json();
 assert.equal(roster.players.length,0);
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

test("abstention endpoint records an explicit skip during voting",async()=>{
 const room=makeRoom();
 await room.ctx.storage.put("room",{chatId:"-100",creatorId:"1",status:"playing",players:{"1":{id:"1",name:"P1"}},game:{phase:"voting",players:[{id:"1",alive:true}],votes:{},abstentions:{}},stateVersion:1});
 const response=await call(room,"/vote/abstain",{actorId:"1"});
 assert.equal(response.status,200);
 const state=await room.ctx.storage.get("room");
 assert.equal(state.game.abstentions["1"],true);
});

test("a round with no nominations advances the round only once",async()=>{
 const room=makeRoom();
 await room.ctx.storage.put("room",{chatId:"-100",creatorId:"1",status:"playing",players:{},stateVersion:1,deadline:Date.now()-1,game:{phase:"nomination",round:1,stateVersion:1,players:[],nominations:{}}});
 await room.alarm();
 const state=await room.ctx.storage.get("room");
 assert.equal(state.game.phase,"night");
 assert.equal(state.game.round,2);
});

test("voting gives missing players a ten-second grace period then skips them",async()=>{
 const room=makeRoom({TELEGRAM_BOT_TOKEN:"test"});
 const previous=globalThis.fetch; const sent=[];
 globalThis.fetch=async(url,options)=>{
  sent.push(JSON.parse(options.body));
  return Response.json({ok:true,result:{message_id:1}});
 };
 try {
  await room.ctx.storage.put("room",{
   chatId:"-100",creatorId:"3",status:"playing",
   players:{
    "1":{id:"1",name:"Player 1"},"2":{id:"2",name:"Player 2"},
    "3":{id:"3",name:"Player 3"},"4":{id:"4",name:"Player 4"}
   },
   stateVersion:1,deadline:Date.now()-1,voteGrace:false,
   game:{phase:"voting",round:1,stateVersion:1,defendant:"2",votes:{"3":"2","4":"2"},abstentions:{},nominations:{},players:[
    {id:"1",role:"citizen",faction:"city",alive:true,health:100},
    {id:"2",role:"boss",faction:"mafia",alive:true,health:100},
    {id:"3",role:"citizen",faction:"city",alive:true,health:100},
    {id:"4",role:"doctor",faction:"city",alive:true,health:100}
   ]}
  });
  await room.alarm();
  let state=await room.ctx.storage.get("room");
  assert.equal(state.voteGrace,true);
  assert.ok(state.deadline>Date.now());
  assert.ok(sent.some(item=>String(item.chat_id)==="-100"&&/10 ثوانٍ/.test(item.text)));
  assert.ok(sent.some(item=>String(item.chat_id)==="1"&&item.reply_markup.inline_keyboard.some(row=>row.some(button=>button.callback_data==="mb:abstain:-100"))));

  state.deadline=Date.now()-1;
  await room.ctx.storage.put("room",state);
  await room.alarm();
  state=await room.ctx.storage.get("room");
  assert.equal(state.voteGrace,false);
  assert.equal(state.status,"ended");
  assert.ok(sent.some(item=>String(item.chat_id)==="-100"&&/لم يصوّت: Player 1، Player 2/.test(item.text)));
 } finally { globalThis.fetch=previous; }
});


test("spectator mode is available only to eliminated players and exposes public history only",async()=>{
 const room=makeRoom();
 await room.ctx.storage.put("room",{
  chatId:"-100",creatorId:"1",status:"playing",players:{"1":{id:"1",name:"P1"}},stateVersion:1,
  game:{phase:"day",round:2,history:[{round:1,phase:"night",text:"مرّت الليلة."}],players:[
   {id:"1",role:"citizen",faction:"city",alive:true},
   {id:"2",role:"boss",faction:"mafia",alive:false}
  ]}
 });
 const alive=await call(room,"/spectate",{actorId:"1"});
 assert.equal(alive.status,403);
 const dead=await call(room,"/spectate",{actorId:"2"});
 assert.equal(dead.status,200);
 const data=await dead.json();
 assert.equal(data.history.length,1);
 assert.equal(data.history[0].text,"مرّت الليلة.");
 assert.equal(JSON.stringify(data).includes("boss"),false);
});

test("public history and match stats can be read without revealing roles",async()=>{
 const room=makeRoom();
 await room.ctx.storage.put("room",{
  chatId:"-100",status:"playing",players:{},game:{phase:"day",round:1,history:[{round:1,phase:"day",text:"بدأ النهار."}],votes:{},abstentions:{},players:[
   {id:"1",role:"citizen",alive:true},{id:"2",role:"boss",alive:false}
  ]}
 });
 const history=await (await call(room,"/history")).json();
 assert.equal(history.history[0].text,"بدأ النهار.");
 assert.equal(JSON.stringify(history).includes("boss"),false);
 const stats=await (await call(room,"/stats")).json();
 assert.equal(stats.players,2);
 assert.equal(stats.survivors,1);
});
