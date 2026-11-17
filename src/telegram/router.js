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
    const response=await roomCall(env,chatId,"/start",{});
    const data=await response.json();
    if(!response.ok) {
      await sendMessage(env,chatId,data.error==="player_count"?"لا يمكن البدء. العدد الحالي "+data.count+"؛ نحتاج من 5 إلى 10 لاعبين.":"تعذر بدء اللعبة: "+(data.error??"خطأ"));
      return;
    }
    const failures=[];
    for(const player of data.players) {
      try { await sendMessage(env,player.id,"🎭 تم توزيع دورك في MAFIA: BETRAYAL\nدورك: "+(ROLE_NAMES[player.role]??player.role)+"\nلا تكشف دورك لأي لاعب."); }
      catch { failures.push(player.name); }
    }
    await sendMessage(env,chatId,"بدأت اللعبة. تم إرسال الأدوار سرًا إلى الخاص."+(failures.length?"\nتعذر مراسلة: "+failures.join("، ")+"\nيجب أن يفتح هؤلاء البوت ويضغطوا Start قبل بدء جولة جديدة.":""));
    return;
  }
  await sendMessage(env,chatId,"أمر غير معروف. أرسل /rules لعرض الأوامر.");
}
