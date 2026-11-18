import { sendMessage, telegramCall } from "./api.js";

const HELP = [
 "🎭 طريقة اللعب — MAFIA: BETRAYAL",
 "• انضموا إلى المجموعة حتى يكتمل 5 لاعبين على الأقل.",
 "• يحصل كل لاعب على دور ومهمة سرية في الخاص.",
 "• ليلًا، تنفّذ الأدوار الخاصة أفعالها من الأزرار.",
 "• نهارًا، تناقشون ثم ترشّحون لاعبًا سرًا من أزرار الخاص.",
 "• بعد الدفاع، صوّتوا على المتهم أو اختاروا الامتناع عن التصويت.",
 "• لا تكشف دورك. يفوز من يحقق هدف فريقه أو مهمته.",
 "• /history لسجل الأحداث، /stats لإحصائيات المباراة، /profile لملفك وإنجازاتك.",
 "• بعد إقصائك استخدم /spectate لمتابعة الأحداث العامة دون التدخل."
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
async function trackUser(env,user) {
 if(!env.DB || !user?.id) return;
 const now=new Date().toISOString();
 const name=[user.first_name,user.last_name].filter(Boolean).join(" ")||user.username||"مستخدم";
 try { await env.DB.prepare("INSERT INTO bot_users (user_id,display_name,username,first_seen_at,last_seen_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,username=excluded.username,last_seen_at=excluded.last_seen_at")
  .bind(String(user.id),name,user.username??null,now,now).run(); } catch(error) { console.error("track_user_failed",error?.message??"unknown"); }
}
async function trackGroup(env,chat,status="active") {
 if(!env.DB || !chat?.id || !["group","supergroup"].includes(chat.type)) return;
 const now=new Date().toISOString();
 try { await env.DB.prepare("INSERT INTO bot_groups (chat_id,title,chat_type,status,added_at,last_seen_at) VALUES (?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET title=excluded.title,chat_type=excluded.chat_type,status=excluded.status,last_seen_at=excluded.last_seen_at,added_at=CASE WHEN excluded.status='active' THEN COALESCE(bot_groups.added_at,excluded.added_at) ELSE bot_groups.added_at END")
  .bind(String(chat.id),String(chat.title??"مجموعة بدون اسم"),chat.type,status,status==="active"?now:null,now).run(); } catch(error) { console.error("track_group_failed",error?.message??"unknown"); }
}
async function handleMembershipUpdate(update,env) {
 const event=update?.my_chat_member;
 if(!event?.chat || !event?.new_chat_member?.user?.is_bot) return false;
 const member=event.new_chat_member;
 const active=["member","administrator"].includes(member.status)||(member.status==="restricted"&&member.is_member===true);
 await trackGroup(env,event.chat,active?"active":"left");
 return true;
}
async function sendOwnerPanel(env,chatId) {
 if(!env.DB) { await sendMessage(env,chatId,"لوحة المالك غير متاحة: قاعدة البيانات غير متصلة."); return; }
 const [userCount,groupCount,users,groups]=await Promise.all([
  env.DB.prepare("SELECT COUNT(*) AS total FROM bot_users").first(),
  env.DB.prepare("SELECT COUNT(*) AS total FROM bot_groups WHERE status='active'").first(),
  env.DB.prepare("SELECT user_id,display_name,username,last_seen_at FROM bot_users ORDER BY last_seen_at DESC LIMIT 10").all(),
  env.DB.prepare("SELECT chat_id,title,chat_type,status,added_at,last_seen_at FROM bot_groups ORDER BY last_seen_at DESC LIMIT 10").all()
 ]);
 const userLines=(users.results??[]).map((u,i)=>(i+1)+". "+u.display_name+" — "+u.user_id+(u.username?" (@"+u.username+")":""));
 const groupLines=(groups.results??[]).map((g,i)=>(i+1)+". "+g.title+" — "+g.chat_id+" ["+(g.status==="active"?"نشطة":"غادرها البوت")+"]");
 const message="🛡️ لوحة مالك MAFIA: BETRAYAL\n\n👥 المستخدمون المسجلون: "+(userCount?.total??0)+"\n🏘️ المجموعات النشطة: "+(groupCount?.total??0)+"\n\n👤 آخر 10 مستخدمين تفاعلوا مع البوت:\n"+(userLines.join("\n")||"لا يوجد مستخدمون مسجلون.")+"\n\n🏘️ آخر 10 مجموعات أُضيف إليها البوت أو تفاعل معها:\n"+(groupLines.join("\n")||"لا توجد مجموعات مسجلة.")+"\n\nملاحظة: التسجيل يبدأ من تفعيل هذا التحديث؛ المجموعات القديمة تُسجّل عند أول تفاعل جديد.";
 await sendMessage(env,chatId,message);
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
 if(await handleMembershipUpdate(update,env)) return;
 const callback=update?.callback_query;
 if(callback?.from) await trackUser(env,callback.from);
 if(callback?.message?.chat) await trackGroup(env,callback.message.chat,"active");
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
 await trackUser(env,message.from);
 await trackGroup(env,message.chat,"active");
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
 if(command==="/panel" && inPrivate) {
  if(String(env.OWNER_TELEGRAM_ID??"")!==actor.id) { await sendMessage(env,chatId,"هذه اللوحة متاحة لمالك البوت فقط."); return; }
  await sendOwnerPanel(env,chatId); return;
 }
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
  const leader=data.creatorName??"قائد الغرفة";
  const lobbyText=response.ok?(command==="/mafia"&&data.isCreator?"🕯️ فُتحت غرفة الغُراب. ":"")+"انضممت إلى الغرفة. عدد اللاعبين: "+data.players+"/10\nقائد الغرفة: "+leader+(data.isCreator?" (أنت)":"\nالقائد وحده يستطيع بدء اللعبة.")+"\nاكتب «أنا» للانضمام، أو اضغط الزر. عندما يكتمل العدد، يكتب القائد «ابدأ».":"تعذر الانضمام: "+(data.error??"خطأ");
  await sendMessage(env,chatId,lobbyText,response.ok?{reply_markup:{inline_keyboard:[[{text:"انضمام إلى اللعبة",callback_data:"mb:join"}],[{text:"ابدأ اللعبة (للقائد فقط)",callback_data:"mb:start"}]]}}:{}); return;
 }
 if(command==="/leave") {
  const response=await roomCall(env,chatId,"/leave",{actorId:actor.id}); const data=await response.json();
  await sendMessage(env,chatId,response.ok?"غادرت غرفة الانتظار.":"تعذر المغادرة: "+(data.error??"خطأ")); return;
 }
 if(command==="/status") {
  const data=await (await roomCall(env,chatId,"/status")).json();
  await sendMessage(env,chatId,"الحالة: "+data.status+"\nاللاعبون: "+data.players+"/10"+(data.phase?"\nالمرحلة: "+data.phase:"")+(data.round?"\nالجولة: "+data.round:"")); return;
 }
 if(command==="/cancelgame") {
  const response=await roomCall(env,chatId,"/cancel",{actorId:actor.id}); const data=await response.json();
  if(!response.ok) {
   await sendMessage(env,chatId,data.error==="creator_only"?"إلغاء اللعبة متاح فقط لمن بدأها.":data.error==="no_active_game"?"لا توجد مباراة نشطة لإلغائها.":"تعذر إلغاء اللعبة: "+(data.error??"خطأ"));
   return;
  }
  await sendMessage(env,chatId,"🛑 أعلن قائد اللعبة الانسحاب من المواجهة. انتهت المباراة وأُغلقت جميع مراحلها ومواعيدها. يمكن بدء غرفة جديدة باستخدام /newgame.");
  return;
 }
 if(command==="/newgame") {
  const response=await roomCall(env,chatId,"/newgame",{actorId:actor.id}); const data=await response.json();
  await sendMessage(env,chatId,response.ok?"🕯️ انتهت آثار الجولة السابقة. فُتحت غرفة جديدة، وصُفّرت قائمة اللاعبين. على الجميع الانضمام من جديد عبر «أنا» أو زر الانضمام؛ لن يُحتسب أحد تلقائيًا.":"تعذر فتح جولة جديدة: "+(data.error??"خطأ")); return;
 }
 if(command==="/profile") {
  const response=await roomCall(env,chatId,"/profile",{actorId:actor.id});
  const data=await response.json();
  if(!response.ok) { await sendMessage(env,chatId,"تعذر تحميل ملف اللاعب: "+(data.error??"خطأ")); return; }
  const recent=(data.recent??[]).map(item=>"• "+(ROLE_NAMES[item.role]??item.role)+" — "+(item.winner==="city"?"فوز المدينة":item.winner==="mafia"?"فوز المافيا":item.winner==="survivor"?"فوز الناجي":item.winner==="gambler"?"فوز المقامر":item.winner??"انتهت"));
  await sendMessage(env,chatId,"👤 ملف اللاعب: "+actor.name+"\nالمباريات: "+data.games+"\nالانتصارات: "+data.wins+"\nالخسائر: "+data.losses+"\nنسبة الفوز: "+data.winRate+"%\nانتصارات المافيا: "+data.mafiaWins+"\nانتصارات المدينة: "+data.cityWins+"\n\n🏅 ألقابك: "+(data.titles?.join("، ")||"لم تحصل على لقب بعد.")+"\n\nآخر المباريات:\n"+(recent.join("\n")||"لا توجد مباريات مسجلة بعد."));
  return;
 }
 if(command==="/history" || command==="/spectate" || command==="/stats") {
  const roomId=inPrivate?parts[1]:chatId;
  if(!roomId || !/^-?[0-9]+$/.test(roomId)) { await sendMessage(env,chatId,"استخدم الأمر داخل مجموعة المباراة، أو أرسل رقم المجموعة بعد الأمر في الخاص."); return; }
  const path=command==="/spectate"?"/spectate":command==="/stats"?"/stats":"/history";
  const response=await roomCall(env,roomId,path,command==="/spectate"?{actorId:actor.id}:null);
  const data=await response.json();
  if(!response.ok) {
   await sendMessage(env,chatId,data.error==="spectator_only_after_elimination"?"وضع المشاهد متاح بعد إقصائك فقط.": "لا يمكن عرض البيانات: "+(data.error??"خطأ"));
   return;
  }
  if(command==="/stats") {
   await sendMessage(env,chatId,"📊 إحصائيات المباراة الحالية\nالجولات: "+data.rounds+"\nاللاعبون: "+data.players+"\nالناجون: "+data.survivors+"\nالمقصون: "+data.eliminated+"\nالأحداث المسجلة: "+data.events);
   return;
  }
  const history=data.history??[];
  const lines=history.slice(-12).map(item=>"الجولة "+item.round+" — "+item.text);
  await sendMessage(env,chatId,(command==="/spectate"?"👁️ وضع المشاهد — متابعة الأحداث العامة فقط.\n\n":"📜 سجل أحداث المباراة\n\n")+(lines.length?lines.join("\n\n"):"لم تُسجل أحداث بعد."));
  return;
 }
 if(command==="/players") {
  const players=await roster(env,chatId);
  await sendMessage(env,chatId,players.length?players.map(p=>p.slot+". "+p.name+(p.alive?"":" — مقصى")).join("\n"):"لا توجد غرفة بعد."); return;
 }
 if(command==="/startgame") {
  const preflight=await roomCall(env,chatId,"/prepare",{actorId:actor.id}); const ready=await preflight.json();
  if(!preflight.ok) {
   const message=ready.error==="player_count"?"العدد الحالي "+ready.count+"؛ نحتاج من 5 إلى 10 لاعبين.":ready.error==="creator_only"?"⛔ بدء اللعبة متاح فقط لمن أنشأ الغرفة: "+(ready.creatorName??"قائد الغرفة")+".":"تعذر تجهيز اللعبة: "+(ready.error??"خطأ");
   await sendMessage(env,chatId,message); return;
  }
  const failures=[];
  for(const p of ready.players) { try { await sendMessage(env,p.id,"تم تجهيز غرفة MAFIA: BETRAYAL. ستصلك رسالتك السرية عند بدء الجولة."); } catch { failures.push(p.name); } }
  if(failures.length) { await sendMessage(env,chatId,"لم تبدأ الجولة. يجب على هؤلاء فتح البوت والضغط على Start: "+failures.join("، ")); return; }
  const response=await roomCall(env,chatId,"/start",{actorId:actor.id}); const data=await response.json();
  if(!response.ok) { await sendMessage(env,chatId,"تعذر بدء اللعبة: "+(data.error??"خطأ")); return; }
  const mafia=data.players.filter(p=>["boss","killer","spy"].includes(p.role));
  const roomInfo=await (await roomCall(env,chatId,"/room-info")).json();
  const deliveryFailures=[];
  for(const p of data.players) {
   const allyNames=mafia.filter(x=>x.id!==p.id).map(x=>x.name);
   const allies=["boss","killer","spy"].includes(p.role)&&allyNames.length?"\n🤝 حلفاؤك في المافيا: "+allyNames.join("، "):"";
   const targets=data.players.filter(x=>x.id!==p.id);
   const action=["boss","killer"].includes(p.role)?"attack":["doctor","guard"].includes(p.role)?"protect":p.role==="detective"?"investigate":p.role==="spy"?"monitor":null;
   const actionHeadings={boss:"🔪 اختر اللاعب الذي تريد المافيا النيل منه هذه الليلة:",killer:"🩸 اختر هدف هجوم المافيا:",doctor:"🩺 اختر اللاعب الذي تريد إنقاذه من الموت:",guard:"🛡️ اختر اللاعب الذي ستوفر له الحماية:",detective:"🔎 اختر اللاعب الذي تريد كشف حقيقته:",spy:"👁️ اختر اللاعب الذي تريد مراقبة تحركاته:"};
   const rows=action?[[{text:"— اختر هدفك —",callback_data:"mb:noop"}],...targets.map(x=>[{text:"🎯 "+x.name,callback_data:"mb:act:"+chatId+":"+action+":"+x.id}])]:[];
   try {
    await sendMessage(env,p.id,"🎭 دورك: "+ROLE_NAMES[p.role]+"\n\n📜 مهمتك: "+ROLE_OBJECTIVES[p.role]+(p.mission?"\n🎲 مهمتك السرية: "+(GAMBLER_MISSION_TEXTS[p.mission]??"أكمل مهمتك."):"")+"\n\n"+(actionHeadings[p.role]??"انتظر المرحلة المناسبة لتصلك اختياراتك السرية.")+"\n\nالمجموعة: "+(roomInfo.chatTitle??"المجموعة")+allies+"\n\n🔒 لا تكشف دورك لأي لاعب. كل اختيار تتخذه هنا يظل سرًا.",rows.length?{reply_markup:{inline_keyboard:rows.slice(1)}}:{});
   } catch { deliveryFailures.push(p.name); }
  }
  await sendMessage(env,chatId,"🕯️ أُغلقت أبواب المدينة... وبدأت لعبة الخيانة. وصلت الأدوار سرًا إلى الخاص.\n\n🌑 حلّ الليل الأول؛ أمام أصحاب الأدوار السرية 90 ثانية للتحرك. لا تثقوا بالصمت... فقد يكون صاحبه هو الخطر."); return; }
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
  for(const item of data.actionReports??[]) {
   await sendMessage(env,item.actorId,item.text);
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
