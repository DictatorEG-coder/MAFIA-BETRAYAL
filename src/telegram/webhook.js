import { routeUpdate } from "./router.js";

export async function handleTelegramUpdate(request, env) {
  const supplied = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!env.TELEGRAM_WEBHOOK_SECRET || supplied !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  let update;
  try { update = await request.json(); }
  catch { return new Response("Bad Request", { status: 400 }); }
  try {
    await routeUpdate(update, env);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("update_failed", error?.message ?? "unknown");
    return Response.json({ ok: false }, { status: 500 });
  }
}
