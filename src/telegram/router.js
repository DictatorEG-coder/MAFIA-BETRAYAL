import { sendMessage } from "./api.js";

const HELP = [
  "🕯️ MAFIA: BETRAYAL — مدينة الغُراب",
  "/mafia — إنشاء غرفة",
  "/join — الانضمام إلى الغرفة",
  "/leave — مغادرة الانتظار",
  "/startgame — بدء اللعبة (5 إلى 10 لاعبين)",
  "/status — حالة الغرفة",
  "/rules — القواعد المختصرة"
].join("\n");

const ROLE_NAMES = {
  detective:"المحقق", doctor:"الطبيب", guard:"الحارس", avenger:"المنتقم", citizen:"المواطن",
  boss:"زعيم المافيا", killer:"القاتل", spy:"الجاسوس", survivor:"الناجي", gambler:"المقامر"
};
const ROLE_OBJECTIVES = {
  detective:"افحص لاعبًا ليلًا لتعرف إن كان من المافيا.",
  doctor:"احمِ لاعبًا كل ليلة من هجوم المافيا.",
  guard:"احمِ لاعبًا كل ليلة من هجوم المافيا.",
  avenger:"دورك الدفاع عن المدينة؛ ستُضاف قدرتك الخاصة في مرحلة التوازن التالية.",
  citizen:"راقب النقاش وصوّت بحذر لإقصاء التهديدات.",
  boss:"نسّق هجوم المافيا ليلًا وابقَ متخفيًا.",
  killer:"شارك المافيا في اختيار هدف الهجوم الليلي.",
  spy:"أنت من المافيا؛ قدرة التخريب لم تُفعّل بعد.",
  survivor:"هدفك البقاء حيًا حتى نهاية الجولة الرابعة.",
  gambler:"أنت مستقل؛ مهمتك السرية لم تُفعّل بعد."
};

async function roomCall(env, chatId, path, body) {
  const stub=env.ROOMS.get(env.ROOMS.idFromName(String(chatId)));
  return stub.fetch("https://room"+path,{method:body?"POST":"GET",headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
}

export async function routeUpdate(update, env) {
  const message=update?.message;
  if(!message?.chat?.id||!message?.from?.id) return;
  const raw=String(message.text??"").trim();
  if(!raw.startsWith("/")) return;
  const command=raw.split(/\s+/,1)[0].split("@")[0].toLowerCase();
  const chatId=String(message.chat.id);
  const actor={id:String(message.from.id),name:[message.from.first_name,message.from.last_name].filter(Boolean).join(" ")||"لاعب"};
  const inPrivate=message.chat.type==="private";

  if(command==="/start"||command==="/rules") {
    await sendMessage(env,chatId,HELP);
    return;
  }
  if(inPrivate) {
    await sendMessage(env,chatId,"افتح البوت أولًا، ثم انضم إلى غرفة اللعبة من المجموعة باستخدام /join.");
    return;
  }
  if(command==="/mafia") {
    const response=await roomCall(env,chatId,"/join",{chatId,actor});
    const data=await response.json();
    await sendMessage(env,chatId,response.ok?"🕯️ فُتحت غرفة الغُراب وأُضيفت إليها. أرسل /join لبقية اللاعبين. نحتاج من 5 إلى 10 لاعبين.":"تعذر إنشاء الغرفة: "+(data.error??"خطأ"));
    return;
  }
  if(command==="/join") {
    const response=await roomCall(env,chatId,"/join",{chatId,actor});
    const data=await response.json();
    await sendMessage(env,chatId,response.ok?"انضممت إلى الغرفة. عدد اللاعبين: "+data.players+"/10":"تعذر الانضمام: "+(data.error??"خطأ"));
    return;
  }
  if(command==="/leave") {
    const response=await roomCall(env,chatId,"/leave",{actorId:actor.id});
    const data=await response.json();
    await sendMessage(env,chatId,response.ok?"غادرت غرفة الانتظار.":"لا يمكنك المغادرة الآن: "+(data.error??"خطأ"));
    return;
  }
  if(command==="/status") {
    const response=await roomCall(env,chatId,"/status");
    const data=await response.json();
    await sendMessage(env,chatId,"الحالة: "+data.status+"\nاللاعبون: "+data.players+"/10"+(data.phase?"\nالمرحلة: "+data.phase:"")+(data.round?"\nالجولة: "+data.round:""));
    return;
  }
  if(command==="/startgame") {
    const preflight=await roomCall(env,chatId,"/prepare",{actorId:actor.id});
    const ready=await preflight.json();
    if(!preflight.ok) {
      await sendMessage(env,chatId,ready.error==="player_count"?"لا يمكن البدء. العدد الحالي "+ready.count+"؛ نحتاج من 5 إلى 10 لاعبين.":"تعذر تجهيز اللعبة: "+(ready.error??"خطأ"));
      return;
    }
    const failures=[];
    for(const player of ready.players) {
      try { await sendMessage(env,player.id,"تم تجهيز غرفة MAFIA: BETRAYAL. ستصلك رسالتك السرية عند بدء الجولة."); }
      catch { failures.push(player.name); }
    }
    if(failures.length) {
      await sendMessage(env,chatId,"لم تبدأ الجولة. يجب على اللاعبين التاليين فتح البوت والضغط على Start ثم إعادة المحاولة: "+failures.join("، "));
      return;
    }
    const response=await roomCall(env,chatId,"/start",{actorId:actor.id});
    const data=await response.json();
    if(!response.ok) {
      await sendMessage(env,chatId,"تعذر بدء اللعبة: "+(data.error??"خطأ"));
      return;
    }
    const mafiaPlayers=data.players.filter(p=>["boss","killer","spy"].includes(p.role));
    for(const player of data.players) {
      const allies=["boss","killer","spy"].includes(player.role) ? "\\nحلفاؤك: "+mafiaPlayers.filter(p=>p.id!==player.id).map(p=>p.name).join("، ") : "";
      await sendMessage(env,player.id,"🎭 MAFIA: BETRAYAL\\nدورك: "+(ROLE_NAMES[player.role]??player.role)+"\\nمهمتك: "+(ROLE_OBJECTIVES[player.role]??"ابقَ على قيد الحياة.")+allies+"\\nلا تكشف دورك لأي لاعب.");
    }
    await sendMessage(env,chatId,"بدأت اللعبة. أُرسلت الأدوار سرًا إلى الخاص.");
    return;
  }
  await sendMessage(env,chatId,"أمر غير معروف. أرسل /rules لعرض الأوامر.");
}
