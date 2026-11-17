export class RoomCoordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/join" && request.method === "POST") {
      const { chatId, actor } = await request.json();
      if (!chatId || !actor?.id) return Response.json({ error: "invalid_input" }, { status: 400 });
      const state = await this.ctx.storage.get("room") ?? {
        chatId: String(chatId), status: "lobby", players: {}, stateVersion: 0
      };
      if (state.status !== "lobby") return Response.json({ error: "game_in_progress" }, { status: 409 });
      state.players[String(actor.id)] = { id: String(actor.id), name: String(actor.name ?? "لاعب") };
      state.stateVersion++;
      await this.ctx.storage.put("room", state);
      return Response.json({ ok: true, players: Object.keys(state.players).length, version: state.stateVersion });
    }
    if (url.pathname === "/status") {
      const state = await this.ctx.storage.get("room");
      return Response.json({ status: state?.status ?? "empty", players: Object.keys(state?.players ?? {}).length });
    }
    if (url.pathname === "/schedule" && request.method === "POST") {
      const body = await request.json();
      const deadline = Number(body.deadline);
      if (!Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + 30 * 60 * 1000) {
        return Response.json({ error: "invalid_deadline" }, { status: 400 });
      }
      const state = await this.ctx.storage.get("room");
      if (!state) return Response.json({ error: "room_not_found" }, { status: 404 });
      state.deadline = deadline;
      state.stateVersion++;
      await this.ctx.storage.put("room", state);
      await this.ctx.storage.setAlarm(deadline);
      return Response.json({ ok: true, deadline, version: state.stateVersion });
    }
    if (url.pathname === "/alarm") return Response.json({ ok: true });
    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    const state = await this.ctx.storage.get("room");
    if (!state || state.status === "lobby" || state.status === "ended") return;
    // Phase deadlines are persisted in storage; alarms recover after hibernation/restart.
    if (state.deadline && state.deadline <= Date.now()) {
      state.phaseExpired = true;
      state.stateVersion++;
      await this.ctx.storage.put("room", state);
    }
  }
}
