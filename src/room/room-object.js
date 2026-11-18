import { createGame } from "../game/engine.js";
import { resolveNight, submitNightAction } from "../game/night.js";
import { nominate, selectDefendant } from "../game/day.js";
import { castVote, castAbstention, finishVoting, avenge } from "../game/engine.js";
import { sendMessage } from "../telegram/api.js";
import { gamblerMissionText } from "../game/gambler.js";
import { chooseNightEvent, appendPublicEvent, getPublicHistory, getGameStats } from "../game/experience.js";

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


  async persistGameResults(state) {
    if (!this.env.DB || !state?.game?.winner || state.game.winner.winner === "cancelled") return;
    const game=state.game;
    const playedAt=new Date(game.endedAt ?? Date.now()).toISOString();
    const winner=game.winner.winner;
    const winnerPlayerId=game.winner.playerId ? String(game.winner.playerId) : null;
    const statements=game.players.map(player=>this.env.DB.prepare(
      "INSERT OR IGNORE INTO player_game_results (game_id,telegram_id,display_name,role,faction,alive,winner,winner_player_id,played_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(String(game.id),String(player.id),String(state.players[player.id]?.name??player.id),String(player.role),String(player.faction),player.alive?1:0,String(winner),winnerPlayerId,playedAt));
    if(statements.length) await this.env.DB.batch(statements);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/join" && request.method === "POST") {
      const { chatId, actor, chatTitle } = await request.json();
      if (!chatId || !actor?.id) return Response.json({ error: "invalid_input" }, { status: 400 });
      const state = await this.ctx.storage.get("room") ?? { chatId:String(chatId), chatTitle:String(chatTitle ?? "المجموعة"), creatorId:String(actor.id), status:"lobby", players:{}, stateVersion:0 };
      if (chatTitle) state.chatTitle=String(chatTitle);
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
    if (url.pathname === "/cancel" && request.method === "POST") {
      const {actorId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state || state.status!=="playing" || !state.game) return Response.json({error:"no_active_game"},{status:409});
      if(state.creatorId!==String(actorId)) return Response.json({error:"creator_only"},{status:403});
      state.status="ended";
      state.game.phase="ended";
      state.game.winner={winner:"cancelled"};
      state.game.endedAt=Date.now();
      state.deadline=null;
      state.voteGrace=false;
      state.stateVersion=(state.stateVersion??0)+1;
      state.game.stateVersion=(state.game.stateVersion??0)+1;
      await this.ctx.storage.deleteAlarm?.();
      await this.ctx.storage.put("room",state);
      if(this.env.DB) {
        await this.env.DB.prepare("UPDATE games SET status='ended',ended_at=?,result_json=? WHERE game_id=?").bind(new Date(state.game.endedAt).toISOString(),JSON.stringify(state.game.winner),state.game.id).run();
        await this.env.DB.prepare("UPDATE rooms SET status='ended',updated_at=? WHERE room_id=?").bind(new Date().toISOString(),state.chatId).run();
      }
      return Response.json({ok:true});
    }
    if (url.pathname === "/newgame" && request.method === "POST") {
      const {actorId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state || state.creatorId!==String(actorId)) return Response.json({error:"creator_only"},{status:403});
      if(state.status!=="ended") return Response.json({error:"game_not_ended"},{status:409});
      state.status="lobby"; state.game=null; state.deadline=null; state.players={}; state.voteGrace=false; state.stateVersion++;
      await this.ctx.storage.deleteAlarm?.();
      await this.ctx.storage.put("room",state);
      if(this.env.DB) {
        await this.env.DB.prepare("DELETE FROM players WHERE room_id=?").bind(state.chatId).run();
        await this.env.DB.prepare("UPDATE rooms SET status=?,updated_at=? WHERE room_id=?").bind("lobby",new Date().toISOString(),state.chatId).run();
      }
      return Response.json({ok:true,players:0});
    }
    if (url.pathname === "/players") {
      const state=await this.ctx.storage.get("room");
      if(!state) return Response.json({players:[]});
      const alive=new Set(state.game?.players.filter(p=>p.alive).map(p=>p.id)??[]);
      return Response.json({players:Object.values(state.players).map((p,index)=>({slot:index+1,id:p.id,name:p.name,role:state.game?.players.find(player=>player.id===p.id)?.role??null,alive:state.game?alive.has(p.id):true}))});
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
    if (url.pathname === "/room-info") {
      const state=await this.ctx.storage.get("room");
      if(!state) return Response.json({error:"room_not_found"},{status:404});
      return Response.json({chatId:state.chatId,chatTitle:state.chatTitle??"المجموعة",status:state.status,phase:state.game?.phase??null,round:state.game?.round??null,defendant:state.game?.defendant??null});
    }
    if (url.pathname === "/profile" && request.method === "POST") {
      const {actorId}=await request.json();
      if(!this.env.DB) return Response.json({error:"stats_unavailable"},{status:503});
      const rows=await this.env.DB.prepare("SELECT display_name,role,faction,alive,winner,winner_player_id,played_at FROM player_game_results WHERE telegram_id=? ORDER BY played_at DESC LIMIT 500").bind(String(actorId)).all();
      const games=rows.results??[];
      const wins=games.filter(row=>row.winner===row.faction||(row.winner==="survivor"&&row.role==="survivor")||(row.winner==="gambler"&&row.winner_player_id===String(actorId))).length;
      const mafiaWins=games.filter(row=>row.faction==="mafia"&&row.winner==="mafia").length;
      const cityWins=games.filter(row=>row.faction==="city"&&row.winner==="city").length;
      const survived=games.filter(row=>row.alive===1).length;
      const titles=[];
      if(games.length>=1) titles.push("🎭 لاعب متمرّس");
      if(wins>=5) titles.push("🏆 صانع الانتصارات");
      if(mafiaWins>=3) titles.push("🕶️ عقل المافيا");
      if(cityWins>=3) titles.push("🛡️ حامي المدينة");
      if(survived>=5) titles.push("🌘 الناجي الصلب");
      return Response.json({games:games.length,wins,losses:games.length-wins,winRate:games.length?Math.round(wins*100/games.length):0,mafiaWins,cityWins,survived,titles,recent:games.slice(0,5).map(row=>({role:row.role,winner:row.winner,playedAt:row.played_at}))});
    }
    if (url.pathname === "/history") {
      const state=await this.ctx.storage.get("room");
      if(!state?.game) return Response.json({error:"no_game"},{status:404});
      return Response.json({history:getPublicHistory(state.game),stats:getGameStats(state.game),phase:state.game.phase,round:state.game.round});
    }
    if (url.pathname === "/spectate" && request.method === "POST") {
      const {actorId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state?.game) return Response.json({error:"no_game"},{status:404});
      const player=state.game.players.find(item=>item.id===String(actorId));
      if(!player || player.alive) return Response.json({error:"spectator_only_after_elimination"},{status:403});
      return Response.json({ok:true,history:getPublicHistory(state.game),stats:getGameStats(state.game),phase:state.game.phase,round:state.game.round});
    }
    if (url.pathname === "/stats") {
      const state=await this.ctx.storage.get("room");
      if(!state?.game) return Response.json({error:"no_game"},{status:404});
      return Response.json(getGameStats(state.game));
    }
    if (url.pathname === "/result") {
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
        await this.persistGameResults(state);
        if(this.env.DB) {
          await this.env.DB.prepare("UPDATE games SET status=?,ended_at=?,result_json=? WHERE game_id=?").bind("ended",new Date(state.game.endedAt).toISOString(),JSON.stringify(state.game.winner),state.game.id).run();
          await this.env.DB.prepare("UPDATE rooms SET status=?,updated_at=? WHERE room_id=?").bind("ended",new Date().toISOString(),state.chatId).run();
        }
      }
      await this.ctx.storage.put("room",state);
      if(state.game.phase!=="ended") await this.ctx.storage.setAlarm(state.deadline);
      else await this.ctx.storage.deleteAlarm?.();
      return Response.json({ok:true,deaths:result.deaths,investigations:result.investigations,monitoring:result.monitoring,actionReports:result.actionReports,phase:state.game.phase,round:state.game.round,winner:state.game.winner});
    }
    if (url.pathname === "/avenge" && request.method === "POST") {
      const {actorId,targetId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state?.game || !["playing","ended"].includes(state.status)) return Response.json({error:"no_active_game"},{status:409});
      try {
        const result=avenge(state.game,actorId,targetId);
        if(state.game.phase==="ended") state.status="ended";
        await this.ctx.storage.put("room",state);
        if(state.game.phase==="ended") {
          await this.persistGameResults(state);
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
      state.game.phase="voting"; state.game.votes={}; state.game.abstentions={}; state.voteGrace=false; state.game.stateVersion++; state.stateVersion++;
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
    if (url.pathname === "/vote/abstain" && request.method === "POST") {
      const {actorId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state?.game || state.status!=="playing") return Response.json({error:"no_active_game"},{status:409});
      try { castAbstention(state.game,actorId); await this.ctx.storage.put("room",state); return Response.json({ok:true}); }
      catch(e){ return Response.json({error:e.message},{status:400}); }
    }
    if (url.pathname === "/vote/finish" && request.method === "POST") {
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
          await this.persistGameResults(state);
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
      for(const id of result.deaths) {
        const fallen=game.players.find(player=>player.id===id&&player.role==="avenger");
        if(fallen) await sendChoices(fallen,"⚔️ لقد أُقصيت. اختر لاعبًا واحدًا للانتقام:","avenge",alive().map(player=>({...player,name:name(player.id)})));
      }
      privateReports=[
        ...(result.actionReports??[]),
        ...(result.investigations??[]).map(item=>({id:item.actorId,text:"نتيجة التحقيق في "+name(item.targetId)+": "+(item.result==="suspicious"?"مشبوه — من المافيا":"غير مشبوه")})),
        ...(result.monitoring??[]).map(item=>({id:item.actorId,text:"نتيجة المراقبة في "+name(item.targetId)+": "+(item.active?"كان نشطًا خلال الليل، وقد نفّذ فعلًا.":"لم يرصد جهازك أي نشاط ليلي له.")}))
      ];
      const roleNames={detective:"المحقق",doctor:"الطبيب",guard:"الحارس",avenger:"المنتقم",citizen:"المواطن",boss:"زعيم المافيا",killer:"القاتل",spy:"الجاسوس",survivor:"الناجي",gambler:"المقامر"};
      const deathLines=[
        "مع أول خيط للفجر، انفتح باب المشرحة على سرٍّ لم يكن ينبغي لأحد رؤيته.",
        "دوّى صراخٌ من آخر الممرات... وعندما وصل الجميع، كان الأوان قد فات.",
        "على أرضية المكان، آثار عراكٍ عنيف. لم ينجُ صاحبها من الليل.",
        "لم تكن تلك ليلة عادية؛ ترك الظلام خلفه ضحية ورسالة بلا توقيع."
      ];
      const deathScenes={
        doctor:"عُثر عليه في غرفة العلاج؛ حقيبته الطبية مبعثرة، ولم تُسعف مهارته هذه المرة.",
        detective:"وُجدت ملاحظاته ممزقة قرب مسرح الجريمة... اقترب من الحقيقة أكثر مما ينبغي.",
        guard:"سقط الحارس وهو يؤدي واجبه؛ لم تعد هناك عين تحرس المدينة.",
        citizen:"كان مواطنًا عاديًا، لكن الليل لم يفرّق بين بريء ومذنب.",
        boss:"انكشفت هوية العقل الذي كان يحرّك الخيوط من الظلام.",
        killer:"انتهت مطاردة القاتل، وسقط السلاح من يده إلى الأبد.",
        spy:"انقطع آخر خيط للتجسس... يبدو أن أحدهم اكتشف مراقب المدينة.",
        avenger:"رحل قبل أن يُكمل انتقامه؛ لكن قصته قد لا تنتهي هنا.",
        survivor:"حتى من ظنّ أن النجاة مضمونة، لم يجد ملاذًا من هذا الليل.",
        gambler:"راهن على الجميع... وخسر الرهان الأخير."
      };
      const revealDeaths=result.deaths.map(id=>{
        const fallen=game.players.find(player=>player.id===id);
        const role=fallen?.role;
        return "🩸 عُثر على جثة "+name(id)+"...\n"+(deathScenes[role]??"ترك الليل خلفه سرًا جديدًا.")+"\n🎭 هويته الحقيقية: "+(roleNames[role]??"مجهولة")+".";
      });
      const nightEvent=chooseNightEvent();
      announcement=result.deaths.length
        ? "🌑 انقشع الظلام، لكن المدينة لم تستيقظ بسلام...\n"+deathLines[Math.floor(Math.random()*deathLines.length)]+"\n\n"+revealDeaths.join("\n")
        : "🌘 مرّت الليلة بلا جثث... لا أحد يعرف إن كان الطبيب قد أنقذ ضحية، أم أن المافيا أخطأت هدفها. الصمت هذه المرة أكثر رعبًا.";
      announcement+="\n\n🕵️ "+nightEvent.title+": "+nightEvent.text;
      if(game.phase==="ended") {
        state.status="ended";
        announcement+="\n🏁 انتهت اللعبة. الفائز: "+(game.winner?.winner??"غير محدد");
      } else {
        game.phase="day";
        state.deadline=Date.now()+120_000;
        announcement+="\n\n☀️ دقّت ساعة المدينة... أمامكم 120 ثانية. تحدثوا، اتهموا، اكشفوا التناقضات؛ فقد يكون القاتل جالسًا بجواركم.";
      }
    } else if(game.phase==="day") {
      game.phase="nomination";
      state.deadline=Date.now()+30_000;
      announcement="🔔 انتهى وقت الكلام. حان وقت الاتهام! أمامكم 30 ثانية لترشيح شخص واحد سرًا. لا تتسرعوا... فصوت واحد قد يرسل بريئًا إلى المقصلة.";
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
        state.deadline=Date.now()+90_000;
        announcement="⚖️ انتهت مهلة الترشيح... لا متهم هذه المرة، لكن هذا لا يعني أن المدينة آمنة. أُغلقت الأبواب وعاد الليل؛ 90 ثانية أخرى، والمافيا تتحرك.";
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
        await sendChoices(player,"🗳️ صوّت سرًا على المتهم: "+name(accused?.id), "vote",accused&&player.id!==accused.id?[{...accused,name:name(accused.id)}]:[],true);
      }
    } else if(game.phase==="voting") {
      const pending=alive().filter(player=>!game.votes?.[player.id]&&!game.abstentions?.[player.id]);
      if(pending.length && !state.voteGrace) {
        state.voteGrace=true;
        state.deadline=Date.now()+10_000;
        const accused=game.players.find(player=>player.id===game.defendant);
        announcement="⏳ لم يصوّت بعد: "+pending.map(player=>name(player.id)).join("، ")+". أمامهم 10 ثوانٍ إضافية، ثم سيُتجاوز تصويتهم.";
        for(const player of pending) {
          await sendChoices(player,"⏳ بقيت 10 ثوانٍ. صوّت على "+name(accused?.id)+" أو اختر الامتناع:","vote",accused&&player.id!==accused.id?[{...accused,name:name(accused.id)}]:[],true);
        }
        await this.ctx.storage.put("room",state);
        await this.ctx.storage.setAlarm(state.deadline);
        if(this.env.TELEGRAM_BOT_TOKEN) await sendMessage(this.env,state.chatId,announcement);
        return;
      }
      const skipped=state.voteGrace?pending:[];
      const abstained=alive().filter(player=>game.abstentions?.[player.id]);
      const abstainedText=abstained.length?"\nامتنع عن التصويت: "+abstained.map(player=>name(player.id)).join("، ")+".":"";
      state.voteGrace=false;
      const completed=finishVoting(game);
      state.game=completed.game;
      if(completed.result.eliminated) {
        const fallen=completed.game.players.find(player=>player.id===completed.result.eliminated&&player.role==="avenger");
        if(fallen) await sendChoices(fallen,"⚔️ لقد أُقصيت. اختر لاعبًا واحدًا للانتقام:","avenge",alive().map(player=>({...player,name:name(player.id)})));
      }
      const activeGambler=completed.game.players.find(player=>player.role==="gambler"&&player.alive);
      if(completed.game.phase!=="ended"&&activeGambler?.mission&&this.env.TELEGRAM_BOT_TOKEN) {
        try { await sendMessage(this.env,activeGambler.id,"🎲 مهمتك السرية الجديدة لهذا الدور: "+gamblerMissionText(activeGambler.mission)); } catch {}
      }
      const skippedText=skipped.length?"\nلم يصوّت: "+skipped.map(player=>name(player.id)).join("، ")+" — تم تجاوز أصواتهم.":"";
      if(completed.game.phase==="ended") {
        state.status="ended";
        const fallen=completed.result.eliminated?completed.game.players.find(player=>player.id===completed.result.eliminated):null;
        const roleNames={detective:"المحقق",doctor:"الطبيب",guard:"الحارس",avenger:"المنتقم",citizen:"المواطن",boss:"زعيم المافيا",killer:"القاتل",spy:"الجاسوس",survivor:"الناجي",gambler:"المقامر"};
        announcement=(fallen?"⚰️ صدر الحكم... أُقصي "+name(fallen.id)+".\n🎭 انكشفت هويته: "+(roleNames[fallen.role]??fallen.role)+".":completed.result.reason==="tie"?"⚖️ انقسمت الأصوات بالتساوي. لم يُقصَ أحد، وبقي الشك بين الجميع.":completed.result.reason==="no_majority"?"⚖️ لم يحصل أي مرشح على أغلبية كافية. نجا المتهم مؤقتًا.":"⚖️ لم تصل أصوات صالحة كافية لإصدار الحكم.")+abstainedText+skippedText+"\n🏁 انتهت اللعبة. الفائز: "+(completed.game.winner?.winner??"غير محدد");
      } else {
        state.deadline=Date.now()+90_000;
        const fallen=completed.result.eliminated?completed.game.players.find(player=>player.id===completed.result.eliminated):null;
        const roleNames={detective:"المحقق",doctor:"الطبيب",guard:"الحارس",avenger:"المنتقم",citizen:"المواطن",boss:"زعيم المافيا",killer:"القاتل",spy:"الجاسوس",survivor:"الناجي",gambler:"المقامر"};
        announcement=(fallen?"⚰️ نُفّذ الحكم على "+name(fallen.id)+"...\n🎭 كان دوره: "+(roleNames[fallen.role]??fallen.role)+".":completed.result.reason==="tie"?"⚖️ تعادل التصويت. لم يُقصَ أحد، وعاد الجميع إلى الليل وهم أكثر ريبة.":completed.result.reason==="no_majority"?"⚖️ لم يحصل المتهم على أغلبية الأصوات؛ لم يُقصَ أحد.":"⚖️ لم تكتمل أصوات صالحة كافية؛ لم يُقصَ أحد.")+abstainedText+skippedText+"\n\n🌙 أُطفئت الأنوار من جديد... أمام المافيا 90 ثانية لتختار ضحيتها التالية.";
      }
    } else {
      return;
    }

    appendPublicEvent(game,{phase:game.phase,text:announcement});
    game.stateVersion=(game.stateVersion??0)+1;
    state.stateVersion=(state.stateVersion??0)+1;
    if(state.status==="ended") {
      await this.persistGameResults(state);
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
