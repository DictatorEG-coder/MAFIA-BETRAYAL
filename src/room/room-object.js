import { createGame } from "../game/engine.js";
import { resolveNight } from "../game/night.js";
import { nominate, selectDefendant } from "../game/day.js";
import { castVote, finishVoting } from "../game/engine.js";

export class RoomCoordinator {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/join" && request.method === "POST") {
      const { chatId, actor } = await request.json();
      if (!chatId || !actor?.id) return Response.json({ error: "invalid_input" }, { status: 400 });
      const state = await this.ctx.storage.get("room") ?? { chatId:String(chatId), status:"lobby", players:{}, stateVersion:0 };
      if (state.chatId !== String(chatId)) return Response.json({ error:"room_mismatch" }, { status:409 });
      if (state.status !== "lobby") return Response.json({ error:"game_in_progress" }, { status:409 });
      if (Object.keys(state.players).length >= 10 && !state.players[String(actor.id)]) return Response.json({ error:"room_full" }, { status:409 });
      state.players[String(actor.id)] = { id:String(actor.id), name:String(actor.name ?? "لاعب") };
      state.stateVersion++;
      await this.ctx.storage.put("room", state);
      return Response.json({ ok:true, players:Object.keys(state.players).length, version:state.stateVersion });
    }
    if (url.pathname === "/leave" && request.method === "POST") {
      const { actorId } = await request.json();
      const state = await this.ctx.storage.get("room");
      if (!state || state.status !== "lobby") return Response.json({ error:"not_in_lobby" }, { status:409 });
      delete state.players[String(actorId)];
      state.stateVersion++;
      await this.ctx.storage.put("room", state);
      return Response.json({ ok:true, players:Object.keys(state.players).length });
    }
    if (url.pathname === "/prepare" && request.method === "POST") {
      const state = await this.ctx.storage.get("room");
      if (!state || state.status !== "lobby") return Response.json({error:"not_in_lobby"},{status:409});
      const ids = Object.keys(state.players);
      if (ids.length < 5 || ids.length > 10) return Response.json({error:"player_count",count:ids.length},{status:400});
      return Response.json({ok:true,players:ids.map(id=>({id,name:state.players[id].name}))});
    }
    if (url.pathname === "/start" && request.method === "POST") {
      const state = await this.ctx.storage.get("room");
      if (!state || state.status !== "lobby") return Response.json({ error:"not_in_lobby" }, { status:409 });
      const ids = Object.keys(state.players);
      if (ids.length < 5 || ids.length > 10) return Response.json({ error:"player_count", count:ids.length }, { status:400 });
      const game = createGame(ids);
      state.status = "playing";
      state.game = game;
      state.stateVersion++;
      await this.ctx.storage.put("room", state);
      return Response.json({ ok:true, gameId:game.id, players:ids.map(id=>({id,name:state.players[id].name,role:game.players.find(p=>p.id===id).role})), round:game.round });
    }
    if (url.pathname === "/status") {
      const state = await this.ctx.storage.get("room");
      return Response.json({ status:state?.status ?? "empty", players:Object.keys(state?.players ?? {}).length, phase:state?.game?.phase ?? null, round:state?.game?.round ?? null });
    }
    if (url.pathname === "/night/resolve" && request.method === "POST") {
      const state = await this.ctx.storage.get("room");
      if (!state?.game || state.status !== "playing") return Response.json({error:"no_active_game"},{status:409});
      const result = resolveNight(state.game);
      state.stateVersion++;
      await this.ctx.storage.put("room",state);
      return Response.json({ok:true,deaths:result.deaths,phase:state.game.phase,round:state.game.round});
    }
    if (url.pathname === "/nominate" && request.method === "POST") {
      const {actorId,targetId}=await request.json();
      const state=await this.ctx.storage.get("room");
      if(!state?.game) return Response.json({error:"no_active_game"},{status:409});
      try { nominate(state.game,actorId,targetId); await this.ctx.storage.put("room",state); return Response.json({ok:true}); }
      catch(e){ return Response.json({error:e.message},{status:400}); }
    }
    if (url.pathname === "/defendant" && request.method === "POST") {
      const state=await this.ctx.storage.get("room");
      if(!state?.game) return Response.json({error:"no_active_game"},{status:409});
      try { const result=selectDefendant(state.game); await this.ctx.storage.put("room",state); return Response.json({ok:true,defendant:result.defendant}); }
      catch(e){ return Response.json({error:e.message},{status:400}); }
    }
    if (url.pathname === "/open-voting" && request.method === "POST") {
      const state=await this.ctx.storage.get("room");
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
      const state=await this.ctx.storage.get("room");
      if(!state?.game) return Response.json({error:"no_active_game"},{status:409});
      try {
        const {game,result}=finishVoting(state.game);
        state.game=game;
        if(game.phase==="ended") state.status="ended";
        await this.ctx.storage.put("room",state);
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
