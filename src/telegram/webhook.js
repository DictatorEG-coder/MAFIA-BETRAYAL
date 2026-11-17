import { routeUpdate } from "./router.js";

export async function handleTelegramUpdate(request, env) {
  const supplied=request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if(!env.TELEGRAM_WEBHOOK_SECRET||supplied!==env.TELEGRAM_WEBHOOK_SECRET) return new Response("Unauthorized",{status:401});
  let update;
  try { update=await request.json(); } catch { return new Response("Bad Request",{status:400}); }

  const updateId=Number(update?.update_id);
  let reserved=false;
  if(env.DB && Number.isSafeInteger(updateId) && updateId>=0) {
    const result=await env.DB.prepare(
      "INSERT OR IGNORE INTO processed_updates (update_id,status,created_at) VALUES (?, 'processing', ?)"
    ).bind(updateId,new Date().toISOString()).run();
    if((result.meta?.changes??0)===0) return Response.json({ok:true,deduplicated:true});
    reserved=true;
  }
  try {
    await routeUpdate(update,env);
    if(reserved) await env.DB.prepare("UPDATE processed_updates SET status='done' WHERE update_id=?").bind(updateId).run();
    return Response.json({ok:true});
  } catch(error) {
    if(reserved) await env.DB.prepare("DELETE FROM processed_updates WHERE update_id=?").bind(updateId).run();
    console.error("update_failed",error?.message??"unknown");
    return Response.json({ok:false},{status:500});
  }
}
