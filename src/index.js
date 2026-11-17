import { handleTelegramUpdate } from "./telegram/webhook.js";
export { RoomCoordinator } from "./room/room-object.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ ok: true, service: "mafia-betrayal" });
    }
    if (url.pathname !== "/telegram/webhook" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }
    return handleTelegramUpdate(request, env);
  }
};
