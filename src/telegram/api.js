export async function telegramCall(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram bot token is not configured");
  const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error("Telegram API request failed: " + method);
  return data.result;
}
export async function sendMessage(env, chatId, text, extra={}) {
  return telegramCall(env,"sendMessage",{chat_id:chatId,text, ...extra});
}
