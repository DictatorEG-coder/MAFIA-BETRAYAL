import test from "node:test";
import assert from "node:assert/strict";
import { handleTelegramUpdate } from "../src/telegram/webhook.js";

test("webhook rejects requests without the configured Telegram secret", async () => {
  const request = new Request("https://example.test/telegram/webhook", { method: "POST", body: "{}" });
  const response = await handleTelegramUpdate(request, { TELEGRAM_WEBHOOK_SECRET: "secret" });
  assert.equal(response.status, 401);
});
test("webhook rejects malformed JSON after valid authentication", async () => {
  const request = new Request("https://example.test/telegram/webhook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "secret" }, body: "{" });
  const response = await handleTelegramUpdate(request, { TELEGRAM_WEBHOOK_SECRET: "secret" });
  assert.equal(response.status, 400);
});
test("duplicate Telegram update IDs are acknowledged without reprocessing", async()=>{
  const rows=new Set();
  const db={prepare(sql){return {bind(id){return {async run(){
    if(sql.startsWith("INSERT OR IGNORE")) { const before=rows.size; rows.add(id); return {meta:{changes:rows.size-before}}; }
    if(sql.startsWith("UPDATE")) return {meta:{changes:1}};
    if(sql.startsWith("DELETE")) { rows.delete(id); return {meta:{changes:1}}; }
    return {meta:{changes:0}};
  }}}}}};
  const env={TELEGRAM_WEBHOOK_SECRET:"secret",DB:db};
  const makeRequest=()=>new Request("https://example.test/telegram/webhook",{
    method:"POST",headers:{"X-Telegram-Bot-Api-Secret-Token":"secret"},body:JSON.stringify({update_id:77})
  });
  const first=await handleTelegramUpdate(makeRequest(),env);
  const second=await handleTelegramUpdate(makeRequest(),env);
  assert.equal(first.status,200);
  assert.deepEqual(await second.json(),{ok:true,deduplicated:true});
});
