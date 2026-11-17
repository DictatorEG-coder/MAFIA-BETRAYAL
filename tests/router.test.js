import test from "node:test";
import assert from "node:assert/strict";
import { routeUpdate } from "../src/telegram/router.js";

test("night actions sent in private chat are routed to the selected group",async()=>{
 const previous=globalThis.fetch;
 const calls=[];
 const stub={async fetch(url,options){
  const path=new URL(url).pathname;
  if(path==="/players") return Response.json({players:[{slot:2,id:"target-2",name:"Player 2",alive:true}]});
  if(path==="/night/action") { calls.push(JSON.parse(options.body)); return Response.json({ok:true}); }
  throw new Error("Unexpected room path "+path);
 }};
 globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:1}});
 try {
  const env={TELEGRAM_BOT_TOKEN:"test",ROOMS:{idFromName:id=>id,get:()=>stub}};
  await routeUpdate({message:{chat:{id:555,type:"private"},from:{id:111,first_name:"A"},text:"/attack -10077 2"}},env);
  assert.deepEqual(calls,[{actorId:"111",action:"attack",targetId:"target-2"}]);
 } finally { globalThis.fetch=previous; }
});

test("group messages cannot expose a player's night action",async()=>{
 const previous=globalThis.fetch;
 let actionCalls=0;
 const stub={async fetch(url){if(new URL(url).pathname==="/night/action") actionCalls++; return Response.json({players:[]});}};
 globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:1}});
 try {
  const env={TELEGRAM_BOT_TOKEN:"test",ROOMS:{idFromName:id=>id,get:()=>stub}};
  await routeUpdate({message:{chat:{id:-10077,type:"supergroup"},from:{id:111,first_name:"A"},text:"/attack 2"}},env);
  assert.equal(actionCalls,0);
 } finally { globalThis.fetch=previous; }
});
