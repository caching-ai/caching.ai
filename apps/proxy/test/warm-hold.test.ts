import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWarmHold,
  lastUserTextAnthropic,
  lastUserTextOpenAI,
  lastUserTextResponses,
  lastUserTextGemini,
  fmtDuration,
  holdReplyText,
  HOLD_DEFAULT_MS,
  HOLD_MAX_MS,
  HOLD_MIN_MS,
} from "../src/logic/warmHold.js";

const H = 3600_000;
const M = 60_000;

test("explicit cai:hold — with, without and with weird durations", () => {
  assert.deepEqual(parseWarmHold("cai:hold 2h"), { ms: 2 * H, lang: "en" });
  assert.deepEqual(parseWarmHold("CAI:HOLD 90m"), { ms: 90 * M, lang: "en" });
  assert.deepEqual(parseWarmHold("cai:hold"), { ms: HOLD_DEFAULT_MS, lang: "en" });
  assert.equal(parseWarmHold("cai:hold 99h")!.ms, HOLD_MAX_MS, "capped at 12h");
  assert.equal(parseWarmHold("cai:hold 1m")!.ms, HOLD_MIN_MS, "floored at 5min");
  assert.deepEqual(parseWarmHold("cai:hold 1시간 30분"), { ms: 90 * M, lang: "ko" });
});

test("natural Korean — short standalone messages", () => {
  assert.deepEqual(parseWarmHold("캐시 2시간 지켜줘"), { ms: 2 * H, lang: "ko" });
  assert.deepEqual(parseWarmHold("캐시 30분만 유지해줘"), { ms: 30 * M, lang: "ko" });
  assert.deepEqual(parseWarmHold("한 시간 캐시 살려줘"), { ms: 1 * H, lang: "ko" });
  assert.deepEqual(parseWarmHold("밥 먹고 올게 캐시 지켜줘"), { ms: HOLD_DEFAULT_MS, lang: "ko" });
});

test("natural English — short standalone messages", () => {
  assert.deepEqual(parseWarmHold("keep my cache warm for 2 hours"), { ms: 2 * H, lang: "en" });
  assert.deepEqual(parseWarmHold("hold the cache please"), { ms: HOLD_DEFAULT_MS, lang: "en" });
});

test("real requests are never intercepted", () => {
  // dev-request words
  assert.equal(parseWarmHold("캐시 유지해주는 코드 짜줘"), null);
  assert.equal(parseWarmHold("explain how our cache hold logic works"), null);
  assert.equal(parseWarmHold("fix the cache keep-alive bug"), null);
  // too long to be a command
  assert.equal(
    parseWarmHold("I want you to look at the cache and keep working on the refactor we discussed yesterday, thanks"),
    null
  );
  // no cache word / no verb
  assert.equal(parseWarmHold("2시간 뒤에 보자"), null);
  assert.equal(parseWarmHold("캐시가 뭐야"), null);
  assert.equal(parseWarmHold(""), null);
});

test("last-user-text extraction handles string and block content", () => {
  assert.equal(
    lastUserTextAnthropic({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }, { role: "user", content: "cai:hold" }] }),
    "cai:hold"
  );
  assert.equal(
    lastUserTextAnthropic({ messages: [{ role: "user", content: [{ type: "text", text: "캐시 지켜줘" }, { type: "image" }] }] }),
    "캐시 지켜줘"
  );
  assert.equal(lastUserTextAnthropic({ messages: [] }), null);
  assert.equal(
    lastUserTextOpenAI({ messages: [{ role: "user", content: [{ type: "text", text: "cai:hold 1h" }] }] }),
    "cai:hold 1h"
  );
});

test("natural Japanese / Spanish / Chinese", () => {
  assert.deepEqual(parseWarmHold("キャッシュを2時間保温して"), { ms: 2 * H, lang: "ja" });
  assert.deepEqual(parseWarmHold("キャッシュを守って"), { ms: HOLD_DEFAULT_MS, lang: "ja" });
  assert.deepEqual(parseWarmHold("mantén mi caché caliente 2 horas"), { ms: 2 * H, lang: "es" });
  assert.deepEqual(parseWarmHold("mantén la caché viva media hora"), { ms: 30 * M, lang: "es" });
  assert.deepEqual(parseWarmHold("帮我保温缓存 2 小时"), { ms: 2 * H, lang: "zh" });
  assert.deepEqual(parseWarmHold("缓存保持 30 分钟"), { ms: 30 * M, lang: "zh" });
  // dev requests in those languages still pass through
  assert.equal(parseWarmHold("キャッシュ保温のコードを書いて"), null);
  assert.equal(parseWarmHold("arregla el código de la caché"), null);
  assert.equal(parseWarmHold("解释一下缓存保温的实现"), null);
  // replies come back in the same language
  assert.match(holdReplyText("held", 2 * H, "ja"), /2時間/);
  assert.match(holdReplyText("held", 2 * H, "zh"), /2小时/);
  assert.match(holdReplyText("keepalive_off", 2 * H, "es"), /keep-alive/i);
});

test("responses / gemini body extraction", () => {
  assert.equal(lastUserTextResponses({ input: "cai:hold 1h" }), "cai:hold 1h");
  assert.equal(
    lastUserTextResponses({ input: [
      { role: "system", content: "be nice" },
      { role: "user", content: [{ type: "input_text", text: "캐시 지켜줘" }] },
    ] }),
    "캐시 지켜줘"
  );
  assert.equal(lastUserTextResponses({ input: [] }), null);
  assert.equal(
    lastUserTextGemini({ contents: [
      { role: "model", parts: [{ text: "hi" }] },
      { role: "user", parts: [{ text: "cai:hold 30m" }] },
    ] }),
    "cai:hold 30m"
  );
  assert.equal(lastUserTextGemini({ contents: [] }), null);
});

test("duration formatting", () => {
  assert.equal(fmtDuration(2 * H, "ko"), "2시간");
  assert.equal(fmtDuration(90 * M, "ko"), "1시간 30분");
  assert.equal(fmtDuration(30 * M, "en"), "30 minutes");
  assert.equal(fmtDuration(2 * H, "en"), "2 hours");
});
