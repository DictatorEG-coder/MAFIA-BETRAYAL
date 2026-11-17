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