import { sendMessage, telegramCall } from "./api.js";

const HELP = [
 "🎭 طريقة اللعب — MAFIA: BETRAYAL",
 "• انضموا إلى المجموعة حتى يكتمل 5 لاعبين على الأقل.",
 "• يحصل كل لاعب على دور ومهمة سرية في الخاص.",
 "• ليلًا، تنفّذ الأدوار الخاصة أفعالها من الأزرار.",
 "• نهارًا، تناقشون ثم ترشّحون لاعبًا سرًا من أزرار الخاص.",
 "• بعد الدفاع، صوّتوا على المتهم أو اختاروا الامتناع عن التصويت.",
 "• لا تكشف دورك. يفوز من يحقق هدف فريقه أو مهمته."
].join("\n");

const GAMBLER_MISSION_TEXTS={survive:"ابقَ حيًا حتى نهاية الجولة الحالية.",nominate:"رشّح اللاعب الذي سيصبح المتهم.",vote:"صوّت للاعب الذي سيتم إقصاؤه."};
const ROLE_NAMES={detective:"المحقق",doctor:"الطبيب",guard:"الحارس",avenger:"المنتقم",citizen:"المواطن",boss:"زعيم المافيا",killer:"القاتل",spy:"الجاسوس",survivor:"الناجي",gambler:"المقامر"};
const ROLE_OBJECTIVES={
 detective:"افحص لاعبًا ليلًا لتعرف إن كان من المافيا.",doctor:"احمِ لاعبًا كل ليلة من هجوم المافيا.",guard:"احمِ لاعبًا كل ليلة من هجوم المافيا.",
 avenger:"إذا أُقصيت، ستظهر لك فرصة لاختيار لاعب واحد للانتقام منه مرة واحدة.",citizen:"راقب النقاش وصوّت بحذر لإقصاء التهديدات.",
 boss:"نسّق هجوم المافيا ليلًا وابقَ متخفيًا.",killer:"شارك المافيا في اختيار هدف الهجوم الليلي.",
 survivor:"هدفك البقاء حيًا حتى نهاية الجولة الرابعة.",spy:"راقب لاعبًا ليلًا لتعرف هل قام بفعل أم بقي ساكنًا، دون كشف دوره.",gambler:"أنت مستقل؛ مهمتك السرية لم تُفعّل بعد."
};
async function roomCall(env,chatId,path,body) {
 const stub=env.ROOMS.get(env.ROOMS.idFromName(String(chatId)));
 return stub.fetch("https://room"+path,{method:body?"POST":"GET",headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
}
async function roster(env,chatId) {
 const response=await roomCall(env,chatId,"/players");
 const data=await response.json();
 return data.players??[];
}
async function announceResult(env,chatId) {
 const response=await roomCall(env,chatId,"/result");
 if(!response.ok) return;
 const data=await response.json();
 const names={city:"المدينة",mafia:"المافيا",survivor:"الناجي"};
 const roles=data.players.map(p=>p.id+" — "+(ROLE_NAMES[p.role]??p.role)+(p.alive?" (باقٍ)":" (مقصى)"));
 await sendMessage(env,chatId,"🏁 انتهت الجولة. الفائز: "+(names[data.winner?.winner]??data.winner?.winner??"غير محدد")+"\nكشف الأدوار:\n"+roles.join("\n"));
}
const OWNER_REACTIONS=new Set(["❤️","🔥","😂","😍","👏","👍","🤝","⚡","🎉","😮","😢","🙏","💯","🥳","💔"]);
async function handleOwnerReaction(message,env,emoji) {
 const ownerId=String(env.OWNER_TELEGRAM_ID??"");
 if(!ownerId || String(message.from.id)!==ownerId) {
  await sendMessage(env,message.chat.id,"هذه الميزة متاحة لمالك البوت فقط.");
  return;
 }
 if(!message.reply_to_message) {
  await sendMessage(env,message.chat.id,"يجب أن ترد على الرسالة التي تريد التفاعل معها، ثم اكتب: تفاعل ❤️");
  return;
 }
 if(!OWNER_REACTIONS.has(emoji)) {
  await sendMessage(env,message.chat.id,"هذا التفاعل غير مدعوم. جرّب: ❤️ 🔥 😂 😍 👏 👍 🤝 ⚡ 🎉");
  return;
 }
 try {
  await telegramCall(env,"setMessageReaction",{chat_id:message.chat.id,message_id:message.reply_to_message.message_id,reaction:[{type:"emoji",emoji}],is_big:true});
 } catch(error) {
  await sendMessage(env,message.chat.id,"تعذر وضع التفاعل: "+(error?.message??"رفض Telegram الطلب. تأكد أن التفاعل مسموح في المجموعة."));
 }
}
export async function routeUpdate(update,env) {
 const callback=update?.callback_query;
 if(callback?.message?.chat?.id && callback?.from?.id) {
  const data=String(callback.data??"");
  const actorId=String(callback.from.id);
  const isPrivate=callback.message.chat.type==="private";
  try {
   if(data==="mb:join"||data==="mb:start") {
    await telegramCall(env,"answerCallbackQuery",{callback_query_id:callback.id});
    return routeUpdate({message:{chat:callback.message.chat,from:callback.from,text:data==="mb:join"?"أنا":"ابدأ"}},env);
   }
   if(data==="mb:rules") {
    await telegramCall(env,"answerCallbackQuery",{callback_query_id:callback.id});
    await sendMessage(env,callback.message.chat.id,"🎭 طريقة اللعب\n\n• اجمعوا 5 لاعبين على الأقل في مجموعة واحدة.\n• يحصل كل لاعب على دور ومهمة سرية في الخاص.\n• ليلًا، تنفّذ الأدوار الخاصة أفعالها من الأزرار.\n• نهارًا، تناقشون ثم ترشّحون لاعبًا سرًا.\n• بعد الدفاع، صوّتوا على المتهم أو اختاروا الامتناع.\n• لا تكشف دورك، وحاول تحقيق هدفك.");
    return;
   }
   if(data.startsWith("mb:act:")) {
    if(!isPrivate) throw new Error("نفّذ الاختيار من الخاص مع البوت.");
    const parts=data.split(":"); const roomId=parts[2], action=parts[3], targetId=parts.slice(4).join(":");
    const path=action==="nominate"?"/nominate":action==="vote"?"/vote":action==="avenge"?"/avenge":"/night/action";
    const body=["nominate","vote","avenge"].includes(action)?{actorId,targetId}:{actorId,action,targetId};
    const response=await roomCall(env,roomId,path,body); const result=await response.json();
    await telegramCall(env,"answerCallbackQuery",{callback_query_id:callback.id,text:response.ok?"تم تسجيل اختيارك سرًا.":(result.error??"لم يُقبل الاختيار."),show_alert:!response.ok});
    if(response.ok && action==="avenge") {
     const players=await roster(env,roomId);
     const target=players.find(player=>player.id===targetId);
     await sendMessage(env,roomId,"سقط "+(target?.name??"لاعب")+" في حادثة غامضة.");
     if(result.phase==="ended") await announceResult(env,roomId);
    }
    if(response.ok) await sendMessage(env,callback.message.chat.id,"تم تسجيل اختيارك سرًا.");
    return;
   }
   if(data.startsWith("mb:abstain:")) {
    if(!isPrivate) throw new Error("نفّذ الامتناع من الخاص مع البوت.");
    const roomId=data.slice("mb:abstain:".length);
    const response=await roomCall(env,roomId,"/vote/abstain",{actorId}); const result=await response.json();
    await telegramCall(env,"answerCallbackQuery",{callback_query_id:callback.id,text:response.ok?"سُجّل امتناعك.":(result.error??"لم يُقبل الامتناع."),show_alert:!response.ok});
    if(response.ok) await sendMessage(env,callback.message.chat.id,"تم تسجيل امتناعك عن التصويت.");
    return;
   }
   await telegramCall(env,"answerCallbackQuery",{callback_query_id:callback.id});
  } catch(error) {
   try { await telegramCall(env,"answerCallbackQuery",{callback_query_id:callback.id,text:error.message??"حدث خطأ",show_alert:true}); } catch {}
  }
  return;
 }
 const message=update?.message;
 if(!message?.chat?.id||!message?.from?.id) return;
 const raw=String(message.text??"").trim();
 const normalized=raw.replace(/[أإآ]/g,"ا");
 if(!raw.startsWith("/")) {
  if(!message.chat.type || message.chat.type==="private") return;
  if(["انا","أنا"].includes(raw) || normalized==="انا") {
   return routeUpdate({message:{...message,text:"/join"}},env);
  }
  if(normalized==="ابدأ" || normalized.toLowerCase()==="ابدا") {
   return routeUpdate({message:{...message,text:"/startgame"}},env);
  }
  if(raw.startsWith("تفاعل ") || raw.startsWith("تفاعل\t")) {
   return handleOwnerReaction(message,env,raw.slice(5).trim());
  }
  return;
 }

 const parts=raw.split(/\s+/);
 const command=parts[0].split("@")[0].toLowerCase();
 const arg=parts[1];
 const chatId=String(message.chat.id);
 const actor={id:String(message.from.id),name:[message.from.first_name,message.from.last_name].filter(Boolean).join(" ")||"لاعب"};
 const inPrivate=message.chat.type==="private";
 if((command==="/start"||command==="/rules") && inPrivate) { await sendMessage(env,chatId,"🕯️ MAFIA: BETRAYAL\n\nلعبة مافيا اجتماعية بأدوار سرية وتحالفات وخداع. انضم إلى مجموعة، ثم اكتب /mafia لفتح غرفة اللعبة. استلم دورك في الخاص واتخذ قراراتك عبر الأزرار دون كتابة أوامر معقدة.\n\nتحتاج المجموعة إلى 5 لاعبين على الأقل.",{reply_markup:{inline_keyboard:[[{text:"➕ إضافة إلى المجموعة",url:"https://t.me/Dictator_mafia_bot?startgroup=play"}],[{text:"📖 طريقة اللعب",callback_data:"mb:rules"}]]}}); return; }
 if(command==="/rules") { await sendMessage(env,chatId,HELP); return; }
 if(command==="/start" && !inPrivate) { await sendMessage(env,chatId,"أهلًا بكم في MAFIA: BETRAYAL. اكتبوا /mafia لإنشاء غرفة جديدة، ثم ينضم اللاعبون ويبدأ قائد الغرفة اللعبة."); return; }
 if(command==="/react") { return handleOwnerReaction(message,env,arg??""); }
 if(inPrivate) {
  if(command==="/myrole") {
   const roomId=parts[1];
   if(!roomId || !/^-?[0-9]+$/.test(roomId)) { await sendMessage(env,chatId,"يُرسل دورك تلقائيًا عند بدء اللعبة. استخدم أزرار الرسالة السرية لاتخاذ قراراتك."); return; }
   const response=await roomCall(env,roomId,"/myrole",{actorId:actor.id}); const data=await response.json();
   if(!response.ok) { await sendMessage(env,chatId,"تعذر استرجاع دورك: "+(data.error??"خطأ")); return; }
   const allies=data.allies?.length?"\nحلفاؤك: "+data.allies.join("، "):"";
   const mission=data.mission?"\nمهمتك السرية لهذه الجولة: "+(GAMBLER_MISSION_TEXTS[data.mission]??"أكمل مهمتك."):"";
   await sendMessage(env,chatId,"🎭 دورك: "+(ROLE_NAMES[data.role]??data.role)+"\nمهمتك: "+(ROLE_OBJECTIVES[data.role]??"ابقَ على قيد الحياة.")+mission+allies); return;
  }
  const privateActions={"/attack":"attack","/protect":"protect","/investigate":"investigate","/spy":"monitor","/nominate":"nominate","/vote":"vote","/avenge":"avenge"};
  if(privateActions[command]) {
   const roomId=parts[1]; const slot=Number(parts[2]);
   if(!roomId || !/^-?[0-9]+$/.test(roomId) || !Number.isInteger(slot) || slot<1 || slot>10) {
    await sendMessage(env,chatId,"استخدم الأزرار التي تصلك في الخاص لتنفيذ أفعالك، ولا تحتاج إلى كتابة أرقام."); return;
   }
   const players=await roster(env,roomId); const target=players.find(p=>p.slot===slot&&p.alive);
   if(!target) { await sendMessage(env,chatId,"اللاعب غير موجود أو أُقصي، أو أن رقم المجموعة غير صحيح."); return; }
   const path=command==="/nominate"?"/nominate":command==="/vote"?"/vote":command==="/avenge"?"/avenge":"/night/action";
   const body=command==="/nominate"||command==="/vote"||command==="/avenge"?{actorId:actor.id,targetId:target.id}:{actorId:actor.id,action:privateActions[command],targetId:target.id};
   const response=await roomCall(env,roomId,path,body); const data=await response.json();
   if(response.ok && command==="/avenge") {
    const targetName=target.name??"اللاعب";
    await sendMessage(env,roomId,"سقط "+targetName+" في حادثة غامضة.");
    await sendMessage(env,chatId,"تم تنفيذ انتقامك. لقد أُقصي الهدف.");
    if(data.phase==="ended") await announceResult(env,roomId);
   } else await sendMessage(env,chatId,response.ok?"تم تسجيل اختيارك سرًا.":"لم يُقبل اختيارك: "+(data.error??"خطأ"));
   return;
  }
  await sendMessage(env,chatId,"قرارات اللعبة تُنفّذ من الأزرار التي تصلك في الخاص. لا تحتاج إلى كتابة أرقام أو أوامر."); return;
 }

 if(command==="/mafia"||command==="/join") {
  const response=await roomCall(env,chatId,"/join",{chatId,actor,chatTitle:message.chat.title??"المجموعة"}); const data=await response.json();
  await sendMessage(env,chatId,response.ok?(command==="/mafia"?"🕯️ فُتحت غرفة الغُراب. ":"")+"انضممت إلى الغرفة. عدد اللاعبين: "+data.players+"/10\nاكتب «أنا» للانضمام، أو اضغط الزر. عندما يكتمل العدد، يكتب قائد الغرفة «ابدأ».":"تعذر الانضمام: "+(data.error??"خطأ"),response.ok?{reply_markup:{inline_keyboard:[[{text:"انضمام إلى اللعبة",callback_data:"mb:join"}],[{text:"ابدأ اللعبة (للقائد)",callback_data:"mb:start"}]]}}:{}); return;
 }
 if(command==="/leave") {
  const response=await roomCall(env,chatId,"/leave",{actorId:actor.id}); const data=await response.json();
  await sendMessage(env,chatId,response.ok?"غادرت غرفة الانتظار.":"تعذر المغادرة: "+(data.error??"خطأ")); return;
 }
 if(command==="/status") {
  const data=await (await roomCall(env,chatId,"/status")).json();
  await sendMessage(env,chatId,"الحالة: "+data.status+"\nاللاعبون: "+data.players+"/10"+(data.phase?"\nالمرحلة: "+data.phase:"")+(data.round?"\nالجولة: "+data.round:"")); return;
 }
 if(command==="/newgame") {
  const response=await roomCall(env,chatId,"/newgame",{actorId:actor.id}); const data=await response.json();
  await sendMessage(env,chatId,response.ok?"أُعيد فتح الغرفة. يمكن للجميع الاستعداد لجولة جديدة.":"تعذر فتح جولة جديدة: "+(data.error??"خطأ")); return;
 }
 if(command==="/players") {
  const players=await roster(env,chatId);
  await sendMessage(env,chatId,players.length?players.map(p=>p.slot+". "+p.name+(p.alive?"":" — مقصى")).join("\n"):"لا توجد غرفة بعد."); return;
 }
 if(command==="/startgame") {
  const preflight=await roomCall(env,chatId,"/prepare",{actorId:actor.id}); const ready=await preflight.json();
  if(!preflight.ok) { await sendMessage(env,chatId,ready.error==="player_count"?"العدد الحالي "+ready.count+"؛ نحتاج من 5 إلى 10 لاعبين.":"تعذر تجهيز اللعبة: "+(ready.error??"خطأ")); return; }
  const failures=[];
  for(const p of ready.players) { try { await sendMessage(env,p.id,"تم تجهيز غرفة MAFIA: BETRAYAL. ستصلك رسالتك السرية عند بدء الجولة."); } catch { failures.push(p.name); } }
  if(failures.length) { await sendMessage(env,chatId,"لم تبدأ الجولة. يجب على هؤلاء فتح البوت والضغط على Start: "+failures.join("، ")); return; }
  const response=await roomCall(env,chatId,"/start",{actorId:actor.id}); const data=await response.json();
  if(!response.ok) { await sendMessage(env,chatId,"تعذر بدء اللعبة: "+(data.error??"خطأ")); return; }
  const mafia=data.players.filter(p=>["boss","killer","spy"].includes(p.role));
  const roomInfo=await (await roomCall(env,chatId,"/room-info")).json();
  const deliveryFailures=[];
  for(const p of data.players) {
   const allies=["boss","killer","spy"].includes(p.role)?"\nحلفاؤك: "+mafia.filter(x=>x.id!==p.id).map(x=>x.name).join("، "):"";
   const targets=data.players.filter(x=>x.id!==p.id);
   const action=["boss","killer"].includes(p.role)?"attack":["doctor","guard"].includes(p.role)?"protect":p.role==="detective"?"investigate":p.role==="spy"?"monitor":null;
   const rows=action?targets.map(x=>[{text:x.name,callback_data:"mb:act:"+chatId+":"+action+":"+x.id}]):[];
   try {
    await sendMessage(env,p.id,"🎭 دورك: "+ROLE_NAMES[p.role]+"\n\nمهمتك: "+ROLE_OBJECTIVES[p.role]+(p.mission?"\nمهمتك السرية: "+(GAMBLER_MISSION_TEXTS[p.mission]??"أكمل مهمتك."):"")+"\nالمجموعة: "+(roomInfo.chatTitle??"المجموعة")+allies+"\n\nلا تكشف دورك لأي لاعب. ستصلك اختياراتك السرية هنا عبر الأزرار.",rows.length?{reply_markup:{inline_keyboard:rows}}:{});
   } catch { deliveryFailures.push(p.name); }
  }
  await sendMessage(env,chatId,"بدأت اللعبة. أُرسلت الأدوار سرًا إلى الخاص. بدأ الليل الأول؛ أمامكم 90 ثانية للأفعال السرية. ستصلكم الترشيحات والتصويتات عبر أزرار خاصة."+(deliveryFailures.length?"\nتعذر إرسال الدور إلى: "+deliveryFailures.join("، "):"")); return; }
 const actionCommands={"/attack":"attack","/protect":"protect","/investigate":"investigate","/spy":"monitor","/nominate":"nominate","/vote":"vote"};
 if(actionCommands[command]) {
  await sendMessage(env,chatId,"للحفاظ على سرية الاختيارات، استخدم الأزرار التي تصلك في الخاص عند فتح مرحلة الترشيح أو التصويت."); return;
 }
 if(command==="/resolve") {
  const response=await roomCall(env,chatId,"/night/resolve",{actorId:actor.id}); const data=await response.json();
  if(!response.ok) { await sendMessage(env,chatId,"تعذر حسم الليل: "+(data.error??"خطأ")); return; }
  const players=await roster(env,chatId);
  for(const id of data.deaths??[]) {
   const fallen=players.find(p=>p.id===id&&p.role==="avenger");
   if(fallen) await sendMessage(env,fallen.id,"⚔️ لقد أُقصيت. اختر لاعبًا واحدًا للانتقام:",{reply_markup:{inline_keyboard:players.filter(p=>p.alive).map(p=>[{text:p.name,callback_data:"mb:act:"+chatId+":avenge:"+p.id}])}});
  }
  for(const item of data.investigations??[]) {
   const target=players.find(p=>p.id===item.targetId);
   await sendMessage(env,item.actorId,"نتيجة التحقيق في "+(target?.name??"اللاعب") +": "+(item.result==="suspicious"?"مشبوه — من المافيا":"غير مشبوه"));
  }
  for(const item of data.monitoring??[]) {
   const target=players.find(p=>p.id===item.targetId);
   await sendMessage(env,item.actorId,"نتيجة المراقبة في "+(target?.name??"اللاعب")+": "+(item.active?"كان نشطًا خلال الليل، وقد نفّذ فعلًا.":"لم يرصد جهازك أي نشاط ليلي له."));
  }
  const dead=(data.deaths??[]).map(id=>players.find(p=>p.id===id)?.name??"لاعب");
  await sendMessage(env,chatId,(dead.length?"انتهى الليل. المقصى: "+dead.join("، "):"انتهى الليل دون إقصاء.")+"\nالمرحلة التالية: "+data.phase);
  if(data.phase==="ended") await announceResult(env,chatId); return;
 }
 if(command==="/defendant") {
  const response=await roomCall(env,chatId,"/defendant",{actorId:actor.id}); const data=await response.json();
  if(!response.ok) { await sendMessage(env,chatId,"تعذر تحديد المتهم: "+(data.error??"خطأ")); return; }
  const players=await roster(env,chatId); const defendant=players.find(p=>p.id===data.defendant);
  await sendMessage(env,chatId,defendant?"المتهم المختار: "+defendant.name+"\nمرحلة الدفاع. بعد انتهائها استخدم /openvote.":"لا يوجد مرشح."); return;
 }
 if(command==="/openvote") {
  const response=await roomCall(env,chatId,"/open-voting",{actorId:actor.id}); const data=await response.json();
  if(!response.ok) { await sendMessage(env,chatId,"تعذر فتح التصويت: "+(data.error??"خطأ")); return; }
  const info=await (await roomCall(env,chatId,"/room-info")).json();
  const players=await roster(env,chatId);
  const accused=players.find(p=>p.id===info.defendant);
  for(const player of players.filter(p=>p.alive)) {
   const rows=[];
   if(accused&&player.id!==accused.id) rows.push([{text:accused.name,callback_data:"mb:act:"+chatId+":vote:"+info.defendant}]);
   rows.push([{text:"امتناع عن التصويت",callback_data:"mb:abstain:"+chatId}]);
   await sendMessage(env,player.id,"🗳️ صوّت سرًا على المتهم: "+(accused?.name??"اللاعب"),{reply_markup:{inline_keyboard:rows}});
  }
  await sendMessage(env,chatId,"بدأ التصويت السري لمدة 60 ثانية. وصلت أزرار التصويت إلى الخاص."); return;
 }
 if(command==="/finishvote") {
  await sendMessage(env,chatId,"ينتهي التصويت تلقائيًا بعد 60 ثانية، ثم يحصل من لم يصوّت على مهلة إضافية قدرها 10 ثوانٍ. لا حاجة لإنهائه يدويًا."); return;
 }
 await sendMessage(env,chatId,"أمر غير معروف. أرسل /rules لعرض الأوامر.");
}
