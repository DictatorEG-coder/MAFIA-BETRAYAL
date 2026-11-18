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


test("Arabic أنا joins the lobby and receives inline join/start buttons",async()=>{
 const previous=globalThis.fetch; const sent=[];
 const stub={async fetch(url,options){
  if(new URL(url).pathname==="/join") return Response.json({ok:true,players:2});
  throw new Error("Unexpected room request");
 }};
 globalThis.fetch=async(url,options)=>{sent.push(JSON.parse(options.body));return Response.json({ok:true,result:{message_id:1}});};
 try {
  const env={TELEGRAM_BOT_TOKEN:"test",ROOMS:{idFromName:id=>id,get:()=>stub}};
  await routeUpdate({message:{chat:{id:-10077,type:"supergroup"},from:{id:111,first_name:"A"},text:"أنا"}},env);
  assert.equal(sent[0].chat_id,"-10077");
  assert.equal(sent[0].reply_markup.inline_keyboard[0][0].callback_data,"mb:join");
  assert.equal(sent[0].reply_markup.inline_keyboard[1][0].callback_data,"mb:start");
 } finally {globalThis.fetch=previous;}
});


test("owner reaction targets the replied-to message and uses selected emoji",async()=>{
 const previous=globalThis.fetch; let payload;
 globalThis.fetch=async(url,options)=>{payload={method:String(url).split("/").pop(),body:JSON.parse(options.body)};return Response.json({ok:true,result:true});};
 try {
  const env={TELEGRAM_BOT_TOKEN:"test",OWNER_TELEGRAM_ID:"5965488029"};
  await routeUpdate({message:{message_id:45,reply_to_message:{message_id:44},chat:{id:-10077,type:"supergroup"},from:{id:5965488029},text:"تفاعل ❤️"}},env);
  assert.equal(payload.method,"setMessageReaction");
  assert.equal(payload.body.message_id,44);
  assert.deepEqual(payload.body.reaction,[{type:"emoji",emoji:"❤️"}]);
 } finally { globalThis.fetch=previous; }
});

test("reaction feature rejects non-owner users",async()=>{
 const previous=globalThis.fetch; const sent=[]; let reactionCalls=0;
 globalThis.fetch=async(url,options)=>{const method=String(url).split("/").pop(); if(method==="setMessageReaction") reactionCalls++; sent.push(JSON.parse(options.body)); return Response.json({ok:true,result:true});};
 try {
  const env={TELEGRAM_BOT_TOKEN:"test",OWNER_TELEGRAM_ID:"5965488029"};
  await routeUpdate({message:{message_id:45,reply_to_message:{message_id:44},chat:{id:-10077,type:"supergroup"},from:{id:111},text:"تفاعل 🔥"}},env);
  assert.equal(reactionCalls,0);
  assert.match(sent[0].text,/مالك البوت فقط/);
 } finally { globalThis.fetch=previous; }
});

test("reaction command requires replying to a target message",async()=>{
 const previous=globalThis.fetch; const sent=[];
 globalThis.fetch=async(url,options)=>{sent.push(JSON.parse(options.body));return Response.json({ok:true,result:{message_id:1}});};
 try {
  const env={TELEGRAM_BOT_TOKEN:"test",OWNER_TELEGRAM_ID:"5965488029"};
  await routeUpdate({message:{message_id:45,chat:{id:-10077,type:"supergroup"},from:{id:5965488029},text:"تفاعل 🔥"}},env);
  assert.match(sent[0].text,/ترد على الرسالة/);
 } finally {globalThis.fetch=previous;}
});

test("private start shows onboarding and add-to-group button instead of numeric commands",async()=>{
 const previous=globalThis.fetch; let payload;
 globalThis.fetch=async(url,options)=>{payload=JSON.parse(options.body);return Response.json({ok:true,result:{message_id:1}});};
 try {
  const env={TELEGRAM_BOT_TOKEN:"test"};
  await routeUpdate({message:{chat:{id:111,type:"private"},from:{id:111,first_name:"A"},text:"/start"}},env);
  assert.match(payload.text,/MAFIA: BETRAYAL/);
  assert.equal(payload.reply_markup.inline_keyboard[0][0].text,"➕ إضافة إلى المجموعة");
  assert.equal(payload.reply_markup.inline_keyboard[0][0].url,"https://t.me/Dictator_mafia_bot?startgroup=play");
  assert.doesNotMatch(payload.text,/رقم_المجموعة/);
 });
});

test("private abstention button is routed to the correct room",async()=>{
 const previous=globalThis.fetch; const calls=[];
 const stub={async fetch(url,options){
  calls.push({path:new URL(url).pathname,body:JSON.parse(options.body)});
  return Response.json({ok:true});
 }};
 globalThis.fetch=async()=>Response.json({ok:true,result:true});
 try {
  const env={TELEGRAM_BOT_TOKEN:"test",ROOMS:{idFromName:id=>id,get:()=>stub}};
  await routeUpdate({callback_query:{id:"cb1",data:"mb:abstain:-10077",from:{id:111},message:{chat:{id:111,type:"private"}}}},env);
  assert.deepEqual(calls,[{path:"/vote/abstain",body:{actorId:"111"}}]);
 } finally {globalThis.fetch=previous;}
});
