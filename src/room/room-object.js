import { createGame } from "../game/engine.js";
import { resolveNight, submitNightAction } from "../game/night.js";
import { nominate, selectDefendant } from "../game/day.js";
import { castVote, finishVoting } from "../game/engine.js";

export class RoomCoordinator {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

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
      const { chatId, actor } = await request.json();
      if (!chatId || !actor?.id) return Response.json({ error: "invalid_input" }, { status: 400 });
      const state = await this.ctx.storage.get("room") ?? { chatId:String(chatId), creatorId:String(actor.id), status:"lobby", players:{}, stateVersion:0 };
      if (state.chatId !== String(chatId)) return Response.json({ error:"room_mismatch" }, { status:409 });
      if (state.status !== "lobby") return Response.json({ error:"game_in_progress" }, { status:409 });
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
      const game = createGame(ids);
      state.status = "playing";
      state.game = game;
      state.stateVersion++;
      await this.ctx.storage.put("room", state);
      await this.persistGameStart(state.chatId,game);
      return Response.json({ ok:true, gameId:game.id, players:ids.map(id=>({id,name:state.players[id].name,role:game.players.find(p=>p.id===id).role})), round:game.round });
    }
    if (url.pathname === "/players") {
      const state=await this.ctx.storage.get("room");
      if(!state) return Response.json({players:[]});
      const alive=new Set(state.game?.players.filter(p=>p.alive).map(p=>p.id)??[]);
      return Response.json({players:Object.values(state.players).map((p,index)=>({slot:index+1,id:p.id,name:p.name,alive:state.game?alive.has(p.id):true}))});
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
      if(state.game.phase==="ended") {
        state.status="ended";
        if(this.env.DB) {
          await this.env.DB.prepare("UPDATE games SET status=?,ended_at=?,result_json=? WHERE game_id=?").bind("ended",new Date(state.game.endedAt).toISOString(),JSON.stringify(state.game.winner),state.game.id).run();
          await this.env.DB.prepare("UPDATE rooms SET status=?,updated_at=? WHERE room_id=?").bind("ended",new Date().toISOString(),state.chatId).run();
        }
      }
      await this.ctx.storage.put("room",state);
      return Response.json({ok:true,deaths:result.deaths,investigations:result.investigations,phase:state.game.phase,round:state.game.round,winner:state.game.winner});
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
      try { const result=selectDefendant(state.game); await this.ctx.storage.put("room",state); return Response.json({ok:true,defendant:result.defendant}); }
      catch(e){ return Response.json({error:e.message},{status:400}); }
    }
    if (url.pathname === "/open-voting" && request.method === "POST") {
      const {actorId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state || state.creatorId!==String(actorId)) return Response.json({error:"creator_only"},{status:403});
      if(!state?.game || state.game.phase!=="defense") return Response.json({error:"defense_not_active"},{status:409});
      state.game.phase="voting"; state.game.stateVersion++; state.stateVersion++;
      await this.ctx.storage.put("room",state);
      return Response.json({ok:true,phase:"voting"});
    }
    if (url.pathname === "/vote" && request.method === "POST") {
      const {actorId,targetId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state?.game) return Response.json({error:"no_active_game"},{status:409});
      try { castVote(state.game,actorId,targetId); await this.ctx.storage.put("room",state); return Response.json({ok:true}); }
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
        await this.ctx.storage.put("room",state);
        if(game.phase==="ended") {
          if(this.env.DB) {
            await this.env.DB.prepare("UPDATE games SET status=?,ended_at=?,result_json=? WHERE game_id=?")
              .bind("ended",new Date(game.endedAt ?? Date.now()).toISOString(),JSON.stringify(game.winner),game.id).run();
            await this.env.DB.prepare("UPDATE rooms SET status=?,updated_at=? WHERE room_id=?")
              .bind("ended",new Date().toISOString(),state.chatId).run();
          }
        }
        return Response.json({ok:true,eliminated:result.eliminated,reason:result.reason,phase:game.phase,round:game.round,winner:game.winner});
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
    if(!state||state.status==="lobby"||state.status==="ended") return;
    if(state.deadline&&state.deadline<=Date.now()) {
      state.phaseExpired=true; state.stateVersion++;
      await this.ctx.storage.put("room",state);
    }
  }
}
