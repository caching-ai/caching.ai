// Warm hold: detect a "keep my cache warm while I'm away" command typed as a
// chat message, so Claude Code / Codex / any proxied chat can extend warming
// past the give-up window without leaving the terminal. All five product
// locales are understood (ko/en/ja/es/zh) and answered in kind.
//
// Only a SHORT, STANDALONE message is treated as a command — the entire
// (trimmed) message must match. Long prompts, or anything that smells like a
// real coding request about caching itself, always pass through untouched:
// a false positive would swallow a real request, which is far worse than
// asking the user to phrase the command explicitly (cai:hold 2h always works).

export type HoldLang = "ko" | "en" | "ja" | "es" | "zh";

export interface WarmHold {
  ms: number;
  lang: HoldLang;
}

export const HOLD_DEFAULT_MS = 2 * 60 * 60 * 1000;
export const HOLD_MIN_MS = 5 * 60 * 1000;
export const HOLD_MAX_MS = 12 * 60 * 60 * 1000;
const NATURAL_MAX_CHARS = 60;

const CACHE_WORD = /캐시|캐쉬|cache|caché|キャッシュ|缓存/i;
const HOLD_VERB =
  /지켜|지키|유지|연장|잡아|살려|식지\s*않|꺼지지\s*않|홀드|hold|keep|warm|extend|stay|守っ|保っ|維持|温め|保温|キープ|消さない|mant[eé]n|mantener|conserva|caliente|viva|保持|维持|守住|保住|别灭|不要灭/i;
// anything that reads like a real dev request must never be intercepted
const DEV_WORDS =
  /코드|구현|짜\s*줘|짜줘|만들|리뷰|버그|테스트|로직|함수|파일|설명|알려|분석|왜|어떻게|뭐야|무엇|code|implement|write|fix|review|bug|test|function|logic|file|explain|analy|why|how|what|debug|コード|実装|修正|バグ|レビュー|関数|ファイル|説明|なぜ|どうやって|c[oó]digo|implementa|arregla|explica|por qu[eé]|c[oó]mo|revisa|funci[oó]n|archivo|代码|实现|修复|解释|为什么|怎么|测试|函数|文件/i;

const KO_WORD_NUMS: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4 };
const ES_WORD_NUMS: Record<string, number> = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4 };

function parseDuration(text: string): number | null {
  let total = 0;
  // unit alternatives ordered longest-first so 分钟 wins over 分, 시간 over nothing
  for (const m of text.matchAll(
    /(\d+(?:\.\d+)?)\s*(시간|時間|小时|个小时|horas?|h(?:ours?|rs?)?|분|分钟|分|minutos?|m(?:in(?:utes?)?)?)/gi
  )) {
    const u = m[2].toLowerCase();
    const hours = /^(시간|時間|小时|个小时|hora|h)/.test(u);
    total += Number(m[1]) * (hours ? 3600_000 : 60_000);
  }
  if (total > 0) return total;
  const ko = text.match(/([한두세네])\s*시간/);
  if (ko) return KO_WORD_NUMS[ko[1]] * 3600_000;
  const es = text.match(/\b(una|un|dos|tres|cuatro)\s+horas?\b/i);
  if (es) return ES_WORD_NUMS[es[1].toLowerCase()] * 3600_000;
  if (/media\s+hora/i.test(text)) return 30 * 60_000;
  return null;
}

function detectLang(text: string): HoldLang {
  if (/[가-힣]/.test(text)) return "ko";
  if (/[ぁ-んァ-ヶ]/.test(text)) return "ja"; // kana beats kanji: ja text always carries some
  if (/[一-鿿]/.test(text)) return "zh";
  if (/caché|mant[eé]n|mantener|horas?|minutos?|caliente|viva|[¿¡ñ]/i.test(text)) return "es";
  return "en";
}

const clamp = (ms: number) => Math.min(HOLD_MAX_MS, Math.max(HOLD_MIN_MS, ms));

export function parseWarmHold(raw: string): WarmHold | null {
  const text = raw.trim();
  if (!text) return null;
  const lang = detectLang(text);

  // explicit form: cai:hold [duration]
  const explicit = text.match(/^cai:hold(?:\s+(.+))?$/i);
  if (explicit) {
    const ms = explicit[1] ? parseDuration(explicit[1]) : null;
    return { ms: clamp(ms ?? HOLD_DEFAULT_MS), lang };
  }

  // natural form: short standalone message about keeping the cache warm
  if (text.length > NATURAL_MAX_CHARS) return null;
  if (!CACHE_WORD.test(text) || !HOLD_VERB.test(text)) return null;
  if (DEV_WORDS.test(text)) return null;
  return { ms: clamp(parseDuration(text) ?? HOLD_DEFAULT_MS), lang };
}

function textFromParts(parts: any[], key: string): string | null {
  const texts = parts
    .filter((p: any) => p && typeof p[key] === "string")
    .map((p: any) => p[key]);
  return texts.length ? texts.join("\n") : null;
}

/** last user-message text from an Anthropic /v1/messages body, if any */
export function lastUserTextAnthropic(body: any): string | null {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const last = [...msgs].reverse().find((m: any) => m?.role === "user");
  if (!last) return null;
  if (typeof last.content === "string") return last.content;
  if (Array.isArray(last.content)) {
    return textFromParts(last.content.filter((b: any) => b?.type === "text"), "text");
  }
  return null;
}

/** last user-message text from an OpenAI chat/completions body, if any */
export function lastUserTextOpenAI(body: any): string | null {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const last = [...msgs].reverse().find((m: any) => m?.role === "user");
  if (!last) return null;
  if (typeof last.content === "string") return last.content;
  if (Array.isArray(last.content)) {
    return textFromParts(last.content.filter((p: any) => p?.type === "text"), "text");
  }
  return null;
}

/** last user text from an OpenAI Responses API body (input: string | items) */
export function lastUserTextResponses(body: any): string | null {
  const input = body?.input;
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return null;
  const last = [...input]
    .reverse()
    .find((it: any) => it && (it.role === "user" || (it.type === "message" && it.role === "user")));
  if (!last) return null;
  if (typeof last.content === "string") return last.content;
  if (Array.isArray(last.content)) {
    return textFromParts(last.content.filter((p: any) => p?.type === "input_text"), "text");
  }
  return null;
}

/** last user text from a Gemini generateContent body */
export function lastUserTextGemini(body: any): string | null {
  const contents = Array.isArray(body?.contents) ? body.contents : [];
  const last = [...contents].reverse().find((c: any) => c && (c.role === "user" || c.role === undefined));
  if (!last || !Array.isArray(last.parts)) return null;
  return textFromParts(last.parts, "text");
}

export function fmtDuration(ms: number, lang: HoldLang): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  switch (lang) {
    case "ko":
      return h && m ? `${h}시간 ${m}분` : h ? `${h}시간` : `${m}분`;
    case "ja":
      return h && m ? `${h}時間${m}分` : h ? `${h}時間` : `${m}分`;
    case "zh":
      return h && m ? `${h}小时${m}分钟` : h ? `${h}小时` : `${m}分钟`;
    case "es": {
      const hs = h ? `${h} hora${h === 1 ? "" : "s"}` : "";
      const ms2 = m ? `${m} minuto${m === 1 ? "" : "s"}` : "";
      return [hs, ms2].filter(Boolean).join(" y ");
    }
    default: {
      const hs = h ? `${h} hour${h === 1 ? "" : "s"}` : "";
      const ms2 = m ? `${m} minute${m === 1 ? "" : "s"}` : "";
      return [hs, ms2].filter(Boolean).join(" ");
    }
  }
}

export type HoldOutcome = "held" | "keepalive_off" | "no_prefix";

const REPLIES: Record<HoldLang, Record<HoldOutcome, (d: string) => string>> = {
  ko: {
    held: (d) =>
      `🔥 캐시 워밍을 지금부터 ${d} 동안 유지할게요. 자리를 비우셔도 캐시가 식지 않아요. 일일 워밍 예산 안에서만 동작하고, 예산에 닿으면 메일로 알려드려요.`,
    keepalive_off: () =>
      `이 키는 캐시 워밍(keep-alive)이 꺼져 있어서 홀드를 걸 수 없어요. 콘솔 > 키 설정에서 캐시 워밍을 켠 뒤 다시 말해 주세요.`,
    no_prefix: () =>
      `아직 워밍할 대화가 저장돼 있지 않아요. 일반 요청을 한 번 보낸 뒤 다시 말해 주시면 그 대화의 캐시를 지켜드릴게요.`,
  },
  en: {
    held: (d) =>
      `🔥 Holding your cache warm for ${d} from now. Step away — it won't go cold. Warming stays within your daily budget; you'll get an email if it's reached.`,
    keepalive_off: () =>
      `Keep-alive is off for this key, so a hold can't be set. Enable cache warming in Console > key settings, then ask again.`,
    no_prefix: () =>
      `There's no saved conversation to keep warm yet. Send one normal request first, then ask again.`,
  },
  ja: {
    held: (d) =>
      `🔥 これから${d}、キャッシュを保温し続けます。席を外しても冷めません。1日の保温予算内でのみ動作し、上限に達したらメールでお知らせします。`,
    keepalive_off: () =>
      `このキーはキャッシュ保温（keep-alive）がオフのため、ホールドを設定できません。コンソール > キー設定で保温をオンにしてから、もう一度どうぞ。`,
    no_prefix: () =>
      `保温できる会話がまだ保存されていません。通常のリクエストを一度送ってから、もう一度どうぞ。`,
  },
  es: {
    held: (d) =>
      `🔥 Mantendré tu caché caliente durante ${d} a partir de ahora. Puedes ausentarte — no se enfriará. El calentamiento respeta tu presupuesto diario; te avisaremos por correo si se alcanza.`,
    keepalive_off: () =>
      `El keep-alive está desactivado para esta clave, así que no se puede fijar la retención. Actívalo en Consola > ajustes de la clave y vuelve a pedirlo.`,
    no_prefix: () =>
      `Aún no hay ninguna conversación guardada que mantener caliente. Envía primero una petición normal y vuelve a pedirlo.`,
  },
  zh: {
    held: (d) =>
      `🔥 从现在起为你保温缓存 ${d}。放心离开 — 缓存不会冷掉。保温只在每日预算内进行，达到上限会邮件通知你。`,
    keepalive_off: () =>
      `这把密钥的缓存保温（keep-alive）是关闭的，无法设置保温锁定。请在控制台 > 密钥设置里开启后再试一次。`,
    no_prefix: () =>
      `还没有可保温的对话。先发送一次正常请求，然后再说一次。`,
  },
};

export function holdReplyText(outcome: HoldOutcome, ms: number, lang: HoldLang): string {
  return REPLIES[lang][outcome](fmtDuration(ms, lang));
}
