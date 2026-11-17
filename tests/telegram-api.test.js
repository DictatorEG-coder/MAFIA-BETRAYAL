import test from "node:test";
import assert from "node:assert/strict";
import { telegramCall } from "../src/telegram/api.js";
test("Telegram API refuses to run without a bot token", async()=>{ await assert.rejects(()=>telegramCall({}, "sendMessage", {}),/not configured/); });
