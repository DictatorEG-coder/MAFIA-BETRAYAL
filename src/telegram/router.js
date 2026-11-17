export async function routeUpdate(update, env) {
  const message = update?.message;
  if (!message?.chat?.id || !message?.from?.id) return;
  const text = String(message.text ?? "").trim();
  if (!text.startsWith("/")) return;
  const chatId = String(message.chat.id);
  const roomId = chatId;
  const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
  const actor = {
    id: String(message.from.id),
    name: [message.from.first_name, message.from.last_name].filter(Boolean).join(" ") || "لاعب"
  };
  if (text.startsWith("/mafia") || text.startsWith("/join")) {
    await stub.fetch("https://room/join", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId, actor })
    });
  } else if (text.startsWith("/status")) {
    await stub.fetch("https://room/status");
  }
}
