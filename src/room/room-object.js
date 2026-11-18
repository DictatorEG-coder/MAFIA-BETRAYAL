import { createGame } from "../game/engine.js";
import { resolveNight, submitNightAction } from "../game/night.js";
import { nominate, selectDefendant } from "../game/day.js";
import { castVote, finishVoting, avenge } from "../game/engine.js";
import { sendMessage } from "../telegram/api.js";
import { gamblerMissionText } from "../game/gambler.js";

export class RoomCoordinator {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async schedulePhase(state, seconds) {
    state.deadline = Date.now() + seconds * 1000;
    state.stateVersion++;
    await this.ctx.storage.put("room", state);
    await this.ctx.storage.setAlarm(state.deadline);
  }

  async persistJoin(chatId, actor, created) {
    if (!this.env.DB) return;
    const now = new Date().toISOString();
    await this.env.DB.prepare(
      "INSERT INTO rooms (room_id,chat_id,status,created_at,updated_at) VALUES (?,?, 'lobby', ?, ?) ON CONFLICT(room_id) DO UPDATE SET updated_at=excluded.updated_at"
    ).bind(String(chatId),String(chatId),now,now).run();
    await this.env.DB.prepare(
      "INSERT INTO players (room_id,telegram_id,display_name,joined_at) VALUES (?,?,?,?) ON CONFLICT(room_id,telegram_id) DO UPDATE SET display_name=excluded.display_name"
    ).bind(String(chatId),String(actor.id),String(actor.name ?? "لاعب"),now).run();
  }

  async persistGameStart(roomId, game) {
    if (!this.env.DB) return;
    const now = new Date(game.startedAt).toISOString();
    await this.env.DB.prepare("UPDATE rooms SET status='playing',updated_at=? WHERE room_id=?").bind(now,String(roomId)).run();
    await this.env.DB.prepare(
      "INSERT INTO games (game_id,room_id,status,started_at) VALUES (?,?,?,?)"
    ).bind(game.id,String(roomId),"playing",now).run();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/join" && request.method === "POST") {
      const { chatId, actor, chatTitle } = await request.json();
      if (!chatId || !actor?.id) return Response.json({ error: "invalid_input" }, { status: 400 });
      const state = await this.ctx.storage.get("room") ?? { chatId:String(chatId), chatTitle:String(chatTitle ?? "المجموعة"), creatorId:String(actor.id), status:"lobby", players:{}, stateVersion:0 };\n      if (chatTitle) state.chatTitle=String(chatTitle);
      if (state.chatId !== String(chatId)) return Response.json({ error:"room_mismatch" }, { status:409 });
      if (!state.creatorId) state.creatorId=String(actor.id);
      if (state.status !== "lobby") return Response.json({ error:"game_in_progress" }, { status:409 });
      if (this.env.DB) {
        const active = await this.env.DB.prepare("SELECT p.room_id FROM players p JOIN rooms r ON r.room_id=p.room_id WHERE p.telegram_id=? AND r.status='playing' LIMIT 1").bind(String(actor.id)).first();
        if (active && active.room_id !== String(chatId)) return Response.json({error:"already_in_active_game"},{status:409});
      }
      if (Object.keys(state.players).length >= 10 && !state.players[String(actor.id)]) return Response.json({ error:"room_full" }, { status:409 });
      state.players[String(actor.id)] = { id:String(actor.id), name:String(actor.name ?? "لاعب") };
      state.stateVersion++;
      await this.ctx.storage.put("room", state);
      await this.persistJoin(chatId,actor);
      return Response.json({ ok:true, players:Object.keys(state.players).length, version:state.stateVersion });
    }
    if (url.pathname === "/leave" && request.method === "POST") {
      const { actorId } = await request.json();
      const state = await this.ctx.storage.get("room");
      if (!state || state.status !== "lobby") return Response.json({ error:"not_in_lobby" }, { status:409 });
      delete state.players[String(actorId)];
      if (this.env.DB) await this.env.DB.prepare("DELETE FROM players WHERE room_id=? AND telegram_id=?").bind(state.chatId,String(actorId)).run();
      if (state.creatorId === String(actorId)) state.creatorId = Object.keys(state.players)[0] ?? null;
      state.stateVersion++;
      await this.ctx.storage.put("room", state);
      return Response.json({ ok:true, players:Object.keys(state.players).length });
    }
    if (url.pathname === "/prepare" && request.method === "POST") {
      const { actorId } = await request.json();
      const state = await this.ctx.storage.get("room");
      if (!state || state.status !== "lobby") return Response.json({error:"not_in_lobby"},{status:409});
      if (!state.creatorId || state.creatorId !== String(actorId)) return Response.json({error:"creator_only"},{status:403});
      const ids = Object.keys(state.players);
      if (ids.length < 5 || ids.length > 10) return Response.json({error:"player_count",count:ids.length},{status:400});
      return Response.json({ok:true,players:ids.map(id=>({id,name:state.players[id].name}))});
    }
    if (url.pathname === "/start" && request.method === "POST") {
      const { actorId } = await request.json();
      const state = await this.ctx.storage.get("room");
      if (!state || state.status !== "lobby") return Response.json({ error:"not_in_lobby" }, { status:409 });
      if (!state.creatorId || state.creatorId !== String(actorId)) return Response.json({ error:"creator_only" }, { status:403 });
      const ids = Object.keys(state.players);
      if (ids.length < 5 || ids.length > 10) return Response.json({ error:"player_count", count:ids.length }, { status:400 });
      if (this.env.DB) {
        const placeholders=ids.map(()=>"?").join(",");
        const active=await this.env.DB.prepare("SELECT p.telegram_id FROM players p JOIN rooms r ON r.room_id=p.room_id WHERE p.telegram_id IN ("+placeholders+") AND r.status='playing' AND p.room_id<>? LIMIT 1").bind(...ids,state.chatId).first();
        if(active) return Response.json({error:"player_already_active",playerId:active.telegram_id},{status:409});
      }
      const game = createGame(ids);
      state.status = "playing";
      state.game = game;
      state.stateVersion++;
      state.deadline = Date.now() + 90_000;
      await this.ctx.storage.put("room", state);
      await this.ctx.storage.setAlarm(state.deadline);
      await this.persistGameStart(state.chatId,game);
      return Response.json({ ok:true, gameId:game.id, players:ids.map(id=>({id,name:state.players[id].name,role:game.players.find(p=>p.id===id).role,mission:game.players.find(p=>p.id===id).mission??null})), round:game.round });
    }
    if (url.pathname === "/newgame" && request.method === "POST") {
      const {actorId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state || state.creatorId!==String(actorId)) return Response.json({error:"creator_only"},{status:403});
      if(state.status!=="ended") return Response.json({error:"game_not_ended"},{status:409});
      state.status="lobby"; state.game=null; state.deadline=null; state.stateVersion++;
      await this.ctx.storage.put("room",state);
      if(this.env.DB) await this.env.DB.prepare("UPDATE rooms SET status=?,updated_at=? WHERE room_id=?").bind("lobby",new Date().toISOString(),state.chatId).run();
      return Response.json({ok:true,players:Object.keys(state.players).length});
    }
    if (url.pathname === "/players") {
      const state=await this.ctx.storage.get("room");
      if(!state) return Response.json({players:[]});
      const alive=new Set(state.game?.players.filter(p=>p.alive).map(p=>p.id)??[]);
      return Response.json({players:Object.values(state.players).map((p,index)=>({slot:index+1,id:p.id,name:p.name,alive:state.game?alive.has(p.id):true}))});
    }
    if (url.pathname === "/myrole" && request.method === "POST") {
      const {actorId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state?.game || state.status!=="playing") return Response.json({error:"no_active_game"},{status:409});
      const player=state.game.players.find(p=>p.id===String(actorId));
      if(!player) return Response.json({error:"not_a_player"},{status:403});
      const allies=player.faction==="mafia"?state.game.players.filter(p=>p.faction==="mafia"&&p.id!==player.id).map(p=>state.players[p.id]?.name??p.id):[];
      return Response.json({role:player.role,allies,mission:player.mission??null});
    }
    if (url.pathname === "/room-info") {\n      const state=await this.ctx.storage.get("room");\n      if(!state) return Response.json({error:"room_not_found"},{status:404});\n      return Response.json({chatId:state.chatId,chatTitle:state.chatTitle??"المجموعة",status:state.status,phase:state.game?.phase??null,round:state.game?.round??null});\n    }\n    if (url.pathname === "/result") {
      const state=await this.ctx.storage.get("room");
      if(!state || state.status!=="ended") return Response.json({error:"game_not_ended"},{status:409});
      return Response.json({winner:state.game.winner,players:state.game.players.map(p=>({id:p.id,role:p.role,faction:p.faction,alive:p.alive}))});
    }
    if (url.pathname === "/status") {
      const state = await this.ctx.storage.get("room");
      return Response.json({ status:state?.status ?? "empty", players:Object.keys(state?.players ?? {}).length, phase:state?.game?.phase ?? null, round:state?.game?.round ?? null });
    }
    if (url.pathname === "/night/action" && request.method === "POST") {
      const {actorId,action,targetId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state?.game || state.status!=="playing") return Response.json({error:"no_active_game"},{status:409});
      try { submitNightAction(state.game,actorId,action,targetId); await this.ctx.storage.put("room",state); return Response.json({ok:true}); }
      catch(e){ return Response.json({error:e.message},{status:400}); }
    }
    if (url.pathname === "/night/resolve" && request.method === "POST") {
      const {actorId}=await request.json();
      const state = await this.ctx.storage.get("room");
      if(!state || state.creatorId!==String(actorId)) return Response.json({error:"creator_only"},{status:403});
      if (!state?.game || state.status !== "playing") return Response.json({error:"no_active_game"},{status:409});
      const result = resolveNight(state.game);
      state.stateVersion++;
      if(state.game.phase!=="ended") state.deadline=Date.now()+120_000;
      if(state.game.phase==="ended") {
        state.status="ended";
        if(this.env.DB) {
          await this.env.DB.prepare("UPDATE games SET status=?,ended_at=?,result_json=? WHERE game_id=?").bind("ended",new Date(state.game.endedAt).toISOString(),JSON.stringify(state.game.winner),state.game.id).run();
          await this.env.DB.prepare("UPDATE rooms SET status=?,updated_at=? WHERE room_id=?").bind("ended",new Date().toISOString(),state.chatId).run();
        }
      }
      await this.ctx.storage.put("room",state);
      if(state.game.phase!=="ended") await this.ctx.storage.setAlarm(state.deadline);
      else await this.ctx.storage.deleteAlarm?.();
      return Response.json({ok:true,deaths:result.deaths,investigations:result.investigations,monitoring:result.monitoring,phase:state.game.phase,round:state.game.round,winner:state.game.winner});
    }
    if (url.pathname === "/avenge" && request.method === "POST") {
      const {actorId,targetId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state?.game || state.status!=="playing") return Response.json({error:"no_active_game"},{status:409});
      try {
        const result=avenge(state.game,actorId,targetId);
        if(state.game.phase==="ended") state.status="ended";
        await this.ctx.storage.put("room",state);
        if(state.game.phase==="ended") {
          await this.ctx.storage.deleteAlarm?.();
          if(this.env.DB) {
            await this.env.DB.prepare("UPDATE games SET status='ended',ended_at=?,result_json=? WHERE game_id=?")
              .bind(new Date(state.game.endedAt).toISOString(),JSON.stringify(state.game.winner),state.game.id).run();
            await this.env.DB.prepare("UPDATE rooms SET status='ended',updated_at=? WHERE room_id=?")
              .bind(new Date().toISOString(),state.chatId).run();
          }
        }
        return Response.json({ok:true,targetId:result.targetId,winner:result.winner,phase:state.game.phase});
      } catch(e) { return Response.json({error:e.message},{status:400}); }
    }
    if (url.pathname === "/nominate" && request.method === "POST") {
      const {actorId,targetId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state?.game) return Response.json({error:"no_active_game"},{status:409});
      try { nominate(state.game,actorId,targetId); await this.ctx.storage.put("room",state); return Response.json({ok:true}); }
      catch(e){ return Response.json({error:e.message},{status:400}); }
    }
    if (url.pathname === "/defendant" && request.method === "POST") {
      const {actorId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state || state.creatorId!==String(actorId)) return Response.json({error:"creator_only"},{status:403});
      if(!state?.game) return Response.json({error:"no_active_game"},{status:409});
      try {
        const result=selectDefendant(state.game);
        if(result.defendant) state.deadline=Date.now()+45_000;
        else state.deadline=Date.now()+90_000;
        await this.ctx.storage.put("room",state);
        await this.ctx.storage.setAlarm(state.deadline);
        return Response.json({ok:true,defendant:result.defendant});
      }
      catch(e){ return Response.json({error:e.message},{status:400}); }
    }
    if (url.pathname === "/open-voting" && request.method === "POST") {
      const {actorId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state || state.creatorId!==String(actorId)) return Response.json({error:"creator_only"},{status:403});
      if(!state?.game || state.game.phase!=="defense") return Response.json({error:"defense_not_active"},{status:409});
      state.game.phase="voting"; state.game.stateVersion++; state.stateVersion++;
      state.deadline=Date.now()+60_000;
      await this.ctx.storage.put("room",state);
      await this.ctx.storage.setAlarm(state.deadline);
      return Response.json({ok:true,phase:"voting"});
    }
    if (url.pathname === "/vote" && request.method === "POST") {
      const {actorId,targetId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state?.game) return Response.json({error:"no_active_game"},{status:409});
      try { castVote(state.game,actorId,targetId); await this.ctx.storage.put("room",state); return Response.json({ok:true}); }
      catch(e){ return Response.json({error:e.message},{status:400}); }
    }
    if (url.pathname === "/vote/abstain" && request.method === "POST") {\n      const {actorId}=await request.json();\n      const state=await this.ctx.storage.get("room");\n      if(!state?.game || state.status!=="playing") return Response.json({error:"no_active_game"},{status:409});\n      try { castAbstention(state.game,actorId); await this.ctx.storage.put("room",state); return Response.json({ok:true}); }\n      catch(e){ return Response.json({error:e.message},{status:400}); }\n    }\n    if (url.pathname === "/vote/finish" && request.method === "POST") {
      const {actorId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state || state.creatorId!==String(actorId)) return Response.json({error:"creator_only"},{status:403});
      if(!state?.game) return Response.json({error:"no_active_game"},{status:409});
      try {
        const {game,result}=finishVoting(state.game);
        state.game=game;
        if(game.phase==="ended") state.status="ended";
        else state.deadline=Date.now()+90_000;
        await this.ctx.storage.put("room",state);
        if(game.phase==="ended") await this.ctx.storage.deleteAlarm?.();
        else await this.ctx.storage.setAlarm(state.deadline);
        if(game.phase==="ended") {
          if(this.env.DB) {
            await this.env.DB.prepare("UPDATE games SET status=?,ended_at=?,result_json=? WHERE game_id=?")
              .bind("ended",new Date(game.endedAt ?? Date.now()).toISOString(),JSON.stringify(game.winner),game.id).run();
            await this.env.DB.prepare("UPDATE rooms SET status=?,updated_at=? WHERE room_id=?")
              .bind("ended",new Date().toISOString(),state.chatId).run();
          }
        }
        const gambler=game.players.find(p=>p.role==="gambler"&&p.alive);
        return Response.json({ok:true,eliminated:result.eliminated,reason:result.reason,phase:game.phase,round:game.round,winner:game.winner,gamblerId:gambler?.id??null,gamblerMission:gambler?.mission??null});
      } catch(e){ return Response.json({error:e.message},{status:400}); }
    }
    if (url.pathname === "/schedule" && request.method === "POST") {
      const body=await request.json(); const deadline=Number(body.deadline);
      if(!Number.isFinite(deadline)||deadline<=Date.now()||deadline>Date.now()+30*60*1000) return Response.json({error:"invalid_deadline"},{status:400});
      const state=await this.ctx.storage.get("room");
      if(!state) return Response.json({error:"room_not_found"},{status:404});
      state.deadline=deadline; state.stateVersion++;
      await this.ctx.storage.put("room",state); await this.ctx.storage.setAlarm(deadline);
      return Response.json({ok:true,deadline,version:state.stateVersion});
    }
    return new Response("Not found",{status:404});
  }

  async alarm() {
    const state=await this.ctx.storage.get("room");
    if(!state||state.status!=="playing"||!state.game||!state.deadline) return;
    if(state.deadline>Date.now()) { await this.ctx.storage.setAlarm(state.deadline); return; }

    const game=state.game;
    let announcement="";
    const alive=()=>game.players.filter(p=>p.alive);
    const name=id=>state.players[id]?.name??"لاعب";
    const sendChoices=async (player,heading,action,targets,includeAbstain=false)=>{
      const rows=targets.map(target=>[{text:target.name??name(target.id),callback_data:"mb:act:"+state.chatId+":"+action+":"+target.id}]);
      if(includeAbstain) rows.push([{text:"امتناع عن التصويت",callback_data:"mb:abstain:"+state.chatId}]);
      if(rows.length) {
        try { await sendMessage(this.env,player.id,heading,{reply_markup:{inline_keyboard:rows}}); }
        catch(error) { console.error("private_choice_delivery_failed",error?.message??"unknown"); }
      }
    };
    let privateReports=[];

    if(game.phase==="night") {
      const result=resolveNight(game);
      privateReports=[
        ...(result.investigations??[]).map(item=>({id:item.actorId,text:"نتيجة التحقيق في "+name(item.targetId)+": "+(item.result==="suspicious"?"مشبوه — من المافيا":"غير مشبوه")})),
        ...(result.monitoring??[]).map(item=>({id:item.actorId,text:"نتيجة المراقبة في "+name(item.targetId)+": "+(item.active?"كان نشطًا خلال الليل، وقد نفّذ فعلًا.":"لم يرصد جهازك أي نشاط ليلي له.")}))
      ];
      announcement=result.deaths.length?"انتهى الليل. تم إقصاء: "+result.deaths.map(name).join("، "):"انتهى الليل دون إقصاء.";
      if(game.phase==="ended") {
        state.status="ended";
        announcement+="\n🏁 انتهت اللعبة. الفائز: "+(game.winner?.winner??"غير محدد");
      } else {
        game.phase="day";
        state.deadline=Date.now()+120_000;
        announcement+="\n☀️ بدأ النهار. أمامكم 120 ثانية للنقاش.";
      }
    } else if(game.phase==="day") {
      game.phase="nomination";
      state.deadline=Date.now()+30_000;
      announcement="انتهى النقاش. أمامكم 30 ثانية للترشيح السري. أرسلنا قائمة اللاعبين إلى الخاص.";
      for(const player of alive()) {
        const targets=alive().filter(target=>target.id!==player.id).map(target=>({...target,name:name(target.id)}));
        await sendChoices(player,"🗳️ اختر لاعبًا لترشيحه سرًا:", "nominate",targets);
      }
    } else if(game.phase==="nomination") {
      const selected=selectDefendant(game);
      if(selected.defendant) {
        state.deadline=Date.now()+45_000;
        announcement="انتهى الترشيح. المتهم: "+name(selected.defendant)+". تبدأ الآن مهلة الدفاع لمدة 45 ثانية.";
      } else {
        game.phase="night";
        game.round++;
        state.deadline=Date.now()+90_000;
        announcement="انتهت مهلة الترشيح دون ترشيحات. لم يُحدد متهم، ولذلك لن يحدث تصويت هذه الجولة. يبدأ الليل التالي.";
      }
    } else if(game.phase==="defense") {
      game.phase="voting";
      game.votes={};
      game.abstentions={};
      state.voteGrace=false;
      state.deadline=Date.now()+60_000;
      const accused=game.players.find(player=>player.id===game.defendant);
      announcement="انتهى الدفاع. بدأ التصويت السري لمدة 60 ثانية. أرسلنا أزرار التصويت إلى الخاص.";
      for(const player of alive()) {
        await sendChoices(player,"🗳️ صوّت سرًا على المتهم: "+name(accused?.id), "vote",accused?[{...accused,name:name(accused.id)}]:[],true);
      }
    } else if(game.phase==="voting") {
      const pending=alive().filter(player=>!game.votes?.[player.id]&&!game.abstentions?.[player.id]);
      if(pending.length && !state.voteGrace) {
        state.voteGrace=true;
        state.deadline=Date.now()+10_000;
        const accused=game.players.find(player=>player.id===game.defendant);
        announcement="⏳ لم يصوّت بعد: "+pending.map(player=>name(player.id)).join("، ")+". أمامهم 10 ثوانٍ إضافية، ثم سيُتجاوز تصويتهم.";
        for(const player of pending) {
          await sendChoices(player,"⏳ بقيت 10 ثوانٍ. صوّت على "+name(accused?.id)+" أو اختر الامتناع:","vote",accused?[{...accused,name:name(accused.id)}]:[],true);
        }
        await this.ctx.storage.put("room",state);
        await this.ctx.storage.setAlarm(state.deadline);
        if(this.env.TELEGRAM_BOT_TOKEN) await sendMessage(this.env,state.chatId,announcement);
        return;
      }
      const skipped=state.voteGrace?pending:[];
      state.voteGrace=false;
      const completed=finishVoting(game);
      state.game=completed.game;
      const activeGambler=completed.game.players.find(player=>player.role==="gambler"&&player.alive);
      if(completed.game.phase!=="ended"&&activeGambler?.mission&&this.env.TELEGRAM_BOT_TOKEN) {
        try { await sendMessage(this.env,activeGambler.id,"🎲 مهمتك السرية الجديدة لهذا الدور: "+gamblerMissionText(activeGambler.mission)); } catch {}
      }
      const skippedText=skipped.length?"\nلم يصوّت: "+skipped.map(player=>name(player.id)).join("، ")+" — تم تجاوز أصواتهم.":"";
      if(completed.game.phase==="ended") {
        state.status="ended";
        announcement=(completed.result.eliminated?"انتهى التصويت وتم إقصاء "+name(completed.result.eliminated)+".":"انتهى التصويت دون إقصاء.")+skippedText+"\n🏁 انتهت اللعبة. الفائز: "+(completed.game.winner?.winner??"غير محدد");
      } else {
        state.deadline=Date.now()+90_000;
        announcement=(completed.result.eliminated?"تم إقصاء "+name(completed.result.eliminated)+".":"لم يُقصَ أحد.")+skippedText+"\n🌙 يبدأ الليل التالي.";
      }
    } else {
      return;
    }

    game.stateVersion=(game.stateVersion??0)+1;
    state.stateVersion=(state.stateVersion??0)+1;
    if(state.status==="ended") {
      const roles={detective:"المحقق",doctor:"الطبيب",guard:"الحارس",avenger:"المنتقم",citizen:"المواطن",boss:"زعيم المافيا",killer:"القاتل",spy:"الجاسوس",survivor:"الناجي",gambler:"المقامر"};
      const reveal=game.players.map(player=>name(player.id)+" — "+(roles[player.role]??player.role)+(player.alive?" (باقٍ)":" (مقصى)"));
      announcement+="\nكشف الأدوار:\n"+reveal.join("\n");
      state.deadline=null;
      await this.ctx.storage.deleteAlarm?.();
      if(this.env.DB) {
        await this.env.DB.prepare("UPDATE games SET status='ended',ended_at=?,result_json=? WHERE game_id=?").bind(new Date(game.endedAt??Date.now()).toISOString(),JSON.stringify(game.winner),game.id).run();
        await this.env.DB.prepare("UPDATE rooms SET status='ended',updated_at=? WHERE room_id=?").bind(new Date().toISOString(),state.chatId).run();
      }
    } else {
      await this.ctx.storage.setAlarm(state.deadline);
    }
    await this.ctx.storage.put("room",state);
    if(this.env.TELEGRAM_BOT_TOKEN) {
      for(const report of privateReports) {
        try { await sendMessage(this.env,report.id,report.text); }
        catch(error) { console.error("private_night_report_failed",error?.message??"unknown"); }
      }
      try { await sendMessage(this.env,state.chatId,announcement); }
      catch(error) { console.error("phase_announcement_failed",error?.message??"unknown"); }
    }
  }
}
}
