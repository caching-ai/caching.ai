// Cache commands: a chat message that asks the proxy — in the user's own
// language — to keep the prompt cache warm. The proxy answers it itself, so
// nothing is forwarded to the model and the command costs zero model tokens.
//
// Since v0.14 the command also PRE-WARMS: the conversation it arrives on is
// the conversation to keep warm, so the proxy captures that prefix, writes it
// upstream with a 1-token ping, and holds the warming window — the cache is
// live the moment the user asks, instead of "send a normal request first".
//
// Sixteen languages are understood and answered in kind. Only a SHORT,
// STANDALONE message is treated as a command — the entire (trimmed) message
// must match. Long prompts, or anything that smells like a real coding
// request about caching itself, always pass through untouched: a false
// positive would swallow a real request, which is far worse than asking the
// user to phrase the command explicitly (`cai:warm 2h` always works).

export type HoldLang =
  | "ko" | "en" | "ja" | "zh" | "es" | "pt" | "fr" | "de"
  | "it" | "ru" | "tr" | "vi" | "id" | "hi" | "th" | "ar";

export interface WarmHold {
  ms: number;
  lang: HoldLang;
}

export const HOLD_DEFAULT_MS = 2 * 60 * 60 * 1000;
export const HOLD_MIN_MS = 5 * 60 * 1000;
export const HOLD_MAX_MS = 12 * 60 * 60 * 1000;
// Non-Latin scripts say the same thing in fewer characters, Latin ones in
// more — one generous cap, with the cache-word + verb + no-dev-word gate
// doing the real precision work.
const NATURAL_MAX_CHARS = 80;

interface LangSpec {
  /** words for "cache" */
  cache: string[];
  /** verbs/adjectives that ask for warming, holding or pre-warming */
  verb: string[];
  /** reads like a real dev request — never intercept (this language only) */
  dev: string[];
  /** duration units */
  hour?: string[];
  min?: string[];
  /** spelled-out durations, in hours (0.5 = half an hour) */
  words?: [string, number][];
  /** distinctive strings that pick this language among the Latin-script ones */
  marker?: string[];
}

// Dev-request words from EVERY language are applied to EVERY message, plus
// these universals. Language detection is a good guess, not a guarantee, and
// the cost of the two errors is not symmetric: blocking a command the user
// then has to phrase explicitly is a nuisance, while forwarding a real
// request into a synthetic reply loses their work.
const DEV_UNIVERSAL = [
  "code", "implement", "refactor", "review", "\\bbug\\b", "\\btest\\b",
  "function", "\\bfile\\b", "debug", "explain", "commit", "\\bapi\\b",
  "\\bcurl\\b", "\\bsql\\b", "\\bdocker\\b",
];

const LANGS: Record<HoldLang, LangSpec> = {
  ko: {
    cache: ["캐시", "캐쉬"],
    verb: [
      "지켜", "지키", "유지", "연장", "잡아", "살려", "식지\\s*않", "꺼지지\\s*않",
      "홀드", "예열", "데워", "데우", "따뜻", "보온", "미리\\s*올려", "살아\\s*있게",
    ],
    dev: [
      "코드", "구현", "짜\\s*줘", "짜줘", "만들", "리뷰", "버그", "테스트", "로직",
      "함수", "파일", "설명", "알려", "분석", "왜", "어떻게", "뭐야", "무엇",
    ],
    hour: ["시간"],
    min: ["분"],
    words: [["반\\s*시간", 0.5], ["한\\s*시간", 1], ["두\\s*시간", 2], ["세\\s*시간", 3], ["네\\s*시간", 4]],
  },
  en: {
    cache: ["cache"],
    verb: [
      "hold", "keep", "warm", "extend", "\\bstay", "pre-?heat", "pre-?warm",
      "alive", "don'?t\\s+let\\s+.{0,12}(expire|cold|die)", "keep\\s+it\\s+hot",
    ],
    dev: [
      "\\bwrite\\b", "\\bfix\\b", "\\bwhy\\b", "\\bhow\\b", "\\bwhat\\b", "logic",
      "analy", "\\bshow\\b", "\\bcheck\\b",
    ],
    hour: ["h(?:ours?|rs?)?"],
    min: ["m(?:in(?:ute)?s?)?"],
    // half first: "half an hour" contains "an hour"
    words: [
      ["half\\s+an?\\s+hour", 0.5], ["(?:an|one)\\s+hour", 1], ["two\\s+hours?", 2],
      ["three\\s+hours?", 3], ["four\\s+hours?", 4],
    ],
  },
  ja: {
    cache: ["キャッシュ"],
    verb: ["守っ", "守って", "保っ", "維持", "温め", "保温", "キープ", "消さない", "延長", "予熱", "温存"],
    dev: ["コード", "実装", "修正", "バグ", "レビュー", "関数", "ファイル", "説明", "なぜ", "どうやって", "何ですか"],
    hour: ["時間"],
    min: ["分"],
    words: [["半時間", 0.5], ["一時間", 1], ["二時間", 2], ["三時間", 3]],
  },
  zh: {
    cache: ["缓存", "快取"],
    verb: ["保温", "保持", "维持", "守住", "保住", "别灭", "不要灭", "预热", "延长", "保活", "别凉", "热着"],
    dev: ["代码", "实现", "修复", "解释", "为什么", "怎么", "测试", "函数", "文件", "分析"],
    hour: ["个小时", "小时", "钟头"],
    min: ["分钟"],
    words: [["半小时", 0.5], ["一小时", 1], ["两小时", 2], ["三小时", 3]],
  },
  es: {
    cache: ["cach[eé]"],
    verb: [
      "mant[eé]n", "mantener", "conserva", "caliente", "\\bviva\\b", "precalient",
      "calienta", "no\\s+.{0,12}(expire|enfr[ií]e)",
    ],
    dev: ["c[oó]digo", "implementa", "arregla", "explica", "por\\s+qu[eé]", "c[oó]mo", "revisa", "funci[oó]n", "archivo"],
    hour: ["horas?", "\\bh\\b"],
    min: ["minutos?", "\\bmin\\b"],
    words: [
      ["media\\s+hora", 0.5], ["\\b(?:una|un)\\s+horas?", 1], ["\\bdos\\s+horas?", 2],
      ["\\btres\\s+horas?", 3], ["\\bcuatro\\s+horas?", 4],
    ],
    // markers must be distinctive: "cache" itself is spelled the same in half
    // of these languages, so only the accented forms qualify
    marker: ["caché", "mant[eé]n", "mantener", "caliente", "media\\s+hora", "[¿¡ñ]"],
  },
  pt: {
    cache: ["cach[eê]"],
    verb: ["mantenha", "manter", "aque[cç]", "quente", "\\bviva\\b", "conserve", "pr[eé]-?aque", "n[aã]o\\s+deixe"],
    dev: ["c[oó]digo", "implemente", "corrija", "explique", "por\\s+que", "\\bcomo\\b", "fun[cç][aã]o", "arquivo"],
    hour: ["horas?", "\\bh\\b"],
    min: ["minutos?", "\\bmin\\b"],
    words: [["meia\\s+hora", 0.5], ["\\buma\\s+horas?", 1], ["\\bduas\\s+horas?", 2], ["\\btr[eê]s\\s+horas?", 3]],
    marker: ["mantenha", "quente", "aque[cç]", "n[aã]o\\s+deixe", "meia\\s+hora", "cachê", "\\bduas\\b"],
  },
  fr: {
    cache: ["cache"],
    verb: [
      "\\bgarde", "maintien", "maintenir", "\\bchaud", "pr[eé]chauff", "r[eé]chauff",
      "conserve", "laisse\\s+pas", "en\\s+vie",
    ],
    dev: ["impl[eé]mente", "corrige", "explique", "pourquoi", "comment", "fonction", "fichier"],
    hour: ["heures?", "\\bh\\b"],
    min: ["minutes?", "\\bmin\\b"],
    words: [["demi-?\\s?heure", 0.5], ["\\bune\\s+heure", 1], ["\\bdeux\\s+heures?", 2], ["\\btrois\\s+heures?", 3]],
    // "minutes" is spelled the same in English — not a French marker
    marker: ["\\bgarde", "maintien", "\\bchaud", "heures?", "pr[eé]chauff", "\\bmon\\b", "\\bpendant\\b"],
  },
  de: {
    cache: ["cache", "zwischenspeicher"],
    verb: ["\\bhalt", "\\bwarm", "aufw[aä]rm", "vorw[aä]rm", "behalt", "nicht\\s+kalt", "am\\s+leben"],
    dev: ["implementier", "behebe", "erkl[aä]r", "\\bwarum\\b", "\\bwie\\b", "funktion", "datei", "zeige"],
    hour: ["stunden?", "\\bstd\\b"],
    min: ["minuten?", "\\bmin\\b"],
    words: [["halbe\\s+stunde", 0.5], ["\\beine\\s+stunde", 1], ["\\bzwei\\s+stunden?", 2], ["\\bdrei\\s+stunden?", 3]],
    marker: ["\\bhalt", "stunden?", "minuten?", "zwischenspeicher", "\\bmeinen\\b", "\\bkalt\\b", "aufw[aä]rm", "erkl[aä]r"],
  },
  it: {
    cache: ["cache"],
    verb: ["mantien", "manteni", "\\btieni", "\\bcaldo", "\\bviva\\b", "preriscald", "riscald", "non\\s+.{0,12}scadere"],
    dev: ["codice", "implementa", "correggi", "spiega", "perch[eé]", "\\bcome\\b", "funzione", "\\bfile\\b"],
    hour: ["\\bore\\b", "\\bora\\b", "\\bh\\b"],
    min: ["minuti", "minuto", "\\bmin\\b"],
    words: [["mezz'?\\s?ora", 0.5], ["\\bun'?\\s?ora", 1], ["\\bdue\\s+ore", 2], ["\\btre\\s+ore", 3]],
    marker: ["mantien", "\\bcald[ao]", "\\bore\\b", "minuti", "preriscald", "\\bmia\\b", "\\bspiega"],
  },
  ru: {
    cache: ["кэш", "кеш"],
    verb: ["держи", "сохрани", "поддержи", "прогре", "разогре", "подогре", "тёплым", "теплым", "продли", "не\\s+дай"],
    dev: ["код", "реализуй", "исправь", "объясни", "почему", "\\bкак\\b", "функци", "файл", "тест"],
    hour: ["час(?:а|ов)?", "ч(?![а-яё])"],
    min: ["минут(?:у|ы)?", "мин(?![а-яё])"],
    words: [["полчаса", 0.5], ["два\\s+час", 2], ["три\\s+час", 3], ["час(?![а-яё])", 1]],
  },
  tr: {
    cache: ["[oö]nbelle[gğ]", "cache"],
    verb: ["\\btut", "s[ıi]cak", "[ıi]s[ıi]t", "canl[ıi]", "so[gğ]umas[ıi]n", "uzat", "koru"],
    dev: ["\\bkod", "uygula", "d[uü]zelt", "a[cç][ıi]kla", "\\bneden\\b", "\\bnas[ıi]l\\b", "fonksiyon", "dosya"],
    hour: ["saat"],
    min: ["dakika", "\\bdk\\b"],
    words: [["yar[ıi]m\\s+saat", 0.5], ["\\bbir\\s+saat", 1], ["\\biki\\s+saat", 2], ["(?:^|\\s)[uü][cç]\\s+saat", 3]],
    marker: ["[oö]nbelle[gğ]", "s[ıi]cak", "\\btut", "saat", "dakika", "[ıi]s[ıi]t"],
  },
  vi: {
    cache: ["cache", "b[ộo]\\s+nh[ớo]\\s+đ[ệe]m"],
    verb: ["gi[ữu]\\s", "n[óo]ng", "l[àa]m\\s+n[óo]ng", "duy\\s+tr[ìi]", "s[ưu][ởo]i", "đ[ừu]ng\\s+.{0,10}ngu[ộo]i"],
    dev: ["\\bm[ãa]\\s", "tri[ểe]n\\s+khai", "\\bs[ửu]a\\b", "gi[ảa]i\\s+th[íi]ch", "t[ạa]i\\s+sao", "l[àa]m\\s+sao", "h[àa]m\\b", "\\bt[ệe]p\\b"],
    hour: ["gi[ờo]", "ti[ếe]ng"],
    min: ["ph[úu]t"],
    words: [["n[ửu]a\\s+(?:gi[ờo]|ti[ếe]ng)", 0.5], ["m[ộo]t\\s+gi[ờo]", 1], ["hai\\s+gi[ờo]", 2], ["ba\\s+gi[ờo]", 3]],
    marker: ["b[ộo]\\s+nh[ớo]\\s+đ[ệe]m", "gi[ữu]\\s", "n[óo]ng", "gi[ờo]", "ph[úu]t", "gi[ảa]i\\s+th[íi]ch"],
  },
  id: {
    cache: ["cache", "tembolok"],
    verb: ["jaga", "tetap", "hangat", "panas", "pertahankan", "panaskan", "jangan\\s+.{0,10}dingin"],
    dev: ["\\bkode\\b", "implementasi", "perbaiki", "jelaskan", "kenapa", "mengapa", "bagaimana", "fungsi", "berkas"],
    hour: ["\\bjam\\b"],
    min: ["menit"],
    words: [["setengah\\s+jam", 0.5], ["satu\\s+jam", 1], ["dua\\s+jam", 2], ["tiga\\s+jam", 3]],
    marker: ["tetap", "hangat", "\\bjaga\\b", "\\bjam\\b", "menit", "panaskan", "tembolok"],
  },
  hi: {
    cache: ["कैश"],
    verb: ["गर्म", "गरम", "रखो", "रखें", "बनाए\\s*रख", "बचाओ", "ज़िंदा", "जिंदा"],
    dev: ["कोड", "लागू", "ठीक", "समझा", "क्यों", "कैसे", "फ़ंक्शन", "फ़ाइल", "फाइल"],
    hour: ["घंटों", "घंटे", "घंटा"],
    min: ["मिनट"],
    words: [["आधा\\s+घंट", 0.5], ["एक\\s+घंट", 1], ["दो\\s+घंट", 2], ["तीन\\s+घंट", 3]],
  },
  th: {
    cache: ["แคช"],
    verb: ["อุ่น", "ร้อน", "เก็บ", "รักษา", "ต่ออายุ", "อย่าให้.{0,8}เย็น", "คงไว้"],
    dev: ["โค้ด", "แก้", "อธิบาย", "ทำไม", "อย่างไร", "ฟังก์ชัน", "ไฟล์", "ทดสอบ"],
    hour: ["ชั่วโมง", "ชม\\.?"],
    min: ["นาที"],
    words: [["ครึ่งชั่วโมง", 0.5], ["หนึ่งชั่วโมง", 1], ["สองชั่วโมง", 2], ["สามชั่วโมง", 3]],
  },
  ar: {
    cache: ["الذاكرة\\s+المؤقتة", "الكاش", "كاش", "الذاكرة\\s+المؤقّتة"],
    verb: ["احتفظ", "أبق", "ابق", "دافئ", "دافئة", "سخّن", "سخن", "حافظ", "لا\\s+تدع", "حي[ةه]"],
    dev: ["كود", "نفذ", "أصلح", "اشرح", "لماذا", "كيف", "دالة", "ملف", "اختبار"],
    hour: ["ساعات", "ساعتين", "ساعة", "ساعه"],
    min: ["دقيقة", "دقائق", "دقيقه"],
    words: [["نصف\\s+ساعة", 0.5], ["ساعتين", 2], ["ثلاث\\s+ساعات", 3]],
  },
};

// Latin-script languages, in tie-break order (English is the fallback).
const LATIN_ORDER: HoldLang[] = ["es", "pt", "fr", "de", "it", "tr", "vi", "id"];

const ALL_LANGS = Object.keys(LANGS) as HoldLang[];
const alt = (parts: string[]) => parts.join("|");
const longestFirst = (parts: string[]) => [...parts].sort((a, b) => b.length - a.length);

const CACHE_WORD = new RegExp(alt(ALL_LANGS.flatMap((l) => LANGS[l].cache)), "iu");
const HOLD_VERB = new RegExp(alt(ALL_LANGS.flatMap((l) => LANGS[l].verb)), "iu");
const DEV_WORDS = new RegExp(
  alt([...ALL_LANGS.flatMap((l) => LANGS[l].dev), ...DEV_UNIVERSAL]), "iu");

// Duration units are matched across every language at once (mixed-language
// commands are the norm: "캐시 keep warm 2 hours"). Hours are tried before
// minutes, longest alternative first, and a unit may not run into a LATIN
// letter — otherwise the bare "h" of "2 hafta" (two weeks) reads as two
// hours. The guard is Latin-only on purpose: "30분만" must still parse.
const HOURS_SRC = alt(longestFirst(ALL_LANGS.flatMap((l) => LANGS[l].hour ?? [])));
const MINS_SRC = alt(longestFirst(ALL_LANGS.flatMap((l) => LANGS[l].min ?? [])));
const DUR_RE = new RegExp(
  `(\\d+(?:[.,]\\d+)?)\\s*(?:(${HOURS_SRC})|(${MINS_SRC}))(?![A-Za-z\\u00C0-\\u024F])`,
  "giu"
);

interface Compiled {
  words: [RegExp, number][];
  marker: RegExp | null;
}
const COMPILED: Record<string, Compiled> = Object.fromEntries(
  ALL_LANGS.map((l) => [
    l,
    {
      words: (LANGS[l].words ?? []).map(([src, hours]) => [new RegExp(src, "iu"), hours] as [RegExp, number]),
      marker: LANGS[l].marker ? new RegExp(alt(LANGS[l].marker!), "giu") : null,
    },
  ])
);

function parseDuration(text: string, lang: HoldLang): number | null {
  let total = 0;
  for (const m of text.matchAll(DUR_RE)) {
    const n = Number(m[1].replace(",", "."));
    if (!Number.isFinite(n)) continue;
    total += n * (m[2] ? 3600_000 : 60_000);
  }
  if (total > 0) return total;
  // spelled-out durations, in the detected language then in English
  for (const l of lang === "en" ? (["en"] as HoldLang[]) : [lang, "en" as HoldLang]) {
    for (const [re, hours] of COMPILED[l].words) {
      if (re.test(text)) return hours * 3600_000;
    }
  }
  return null;
}

function detectLang(text: string): HoldLang {
  if (/[가-힣]/.test(text)) return "ko";
  if (/[ぁ-んァ-ヶ]/.test(text)) return "ja"; // kana beats kanji: ja text always carries some
  if (/[一-鿿]/.test(text)) return "zh";
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  if (/[฀-๿]/.test(text)) return "th";
  if (/[؀-ۿ]/.test(text)) return "ar";
  // Latin script: the language with the most distinctive markers wins, and
  // English answers when nothing distinctive shows up.
  let best: HoldLang = "en";
  let bestScore = 0;
  for (const lang of LATIN_ORDER) {
    const re = COMPILED[lang].marker;
    if (!re) continue;
    const hits = text.match(re)?.length ?? 0;
    if (hits > bestScore) {
      bestScore = hits;
      best = lang;
    }
  }
  return best;
}

const clamp = (ms: number) => Math.min(HOLD_MAX_MS, Math.max(HOLD_MIN_MS, ms));

export function parseWarmHold(raw: string): WarmHold | null {
  const text = raw.trim();
  if (!text) return null;
  const lang = detectLang(text);

  // explicit form: cai:hold / cai:warm [duration]
  const explicit = text.match(/^cai:(?:hold|warm)(?:\s+(.+))?$/i);
  if (explicit) {
    const ms = explicit[1] ? parseDuration(explicit[1], lang) : null;
    return { ms: clamp(ms ?? HOLD_DEFAULT_MS), lang };
  }

  // natural form: short standalone message about keeping the cache warm
  if (text.length > NATURAL_MAX_CHARS) return null;
  if (!CACHE_WORD.test(text) || !HOLD_VERB.test(text)) return null;
  if (DEV_WORDS.test(text)) return null;
  return { ms: clamp(parseDuration(text, lang) ?? HOLD_DEFAULT_MS), lang };
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

interface DurUnits {
  h: (n: number) => string;
  m: (n: number) => string;
  /** joiner between the hour and minute part */
  sep: string;
}

// Russian needs real plural agreement (2 часа / 5 часов); the rest get by
// with one or two forms.
const ruPlural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

const UNITS: Record<HoldLang, DurUnits> = {
  ko: { h: (n) => `${n}시간`, m: (n) => `${n}분`, sep: " " },
  en: { h: (n) => `${n} hour${n === 1 ? "" : "s"}`, m: (n) => `${n} minute${n === 1 ? "" : "s"}`, sep: " " },
  ja: { h: (n) => `${n}時間`, m: (n) => `${n}分`, sep: "" },
  zh: { h: (n) => `${n}小时`, m: (n) => `${n}分钟`, sep: "" },
  es: { h: (n) => `${n} hora${n === 1 ? "" : "s"}`, m: (n) => `${n} minuto${n === 1 ? "" : "s"}`, sep: " y " },
  pt: { h: (n) => `${n} hora${n === 1 ? "" : "s"}`, m: (n) => `${n} minuto${n === 1 ? "" : "s"}`, sep: " e " },
  fr: { h: (n) => `${n} heure${n === 1 ? "" : "s"}`, m: (n) => `${n} minute${n === 1 ? "" : "s"}`, sep: " et " },
  de: { h: (n) => `${n} Stunde${n === 1 ? "" : "n"}`, m: (n) => `${n} Minute${n === 1 ? "" : "n"}`, sep: " " },
  it: { h: (n) => (n === 1 ? "1 ora" : `${n} ore`), m: (n) => (n === 1 ? "1 minuto" : `${n} minuti`), sep: " e " },
  ru: {
    h: (n) => `${n} ${ruPlural(n, "час", "часа", "часов")}`,
    m: (n) => `${n} ${ruPlural(n, "минуту", "минуты", "минут")}`,
    sep: " ",
  },
  tr: { h: (n) => `${n} saat`, m: (n) => `${n} dakika`, sep: " " },
  vi: { h: (n) => `${n} giờ`, m: (n) => `${n} phút`, sep: " " },
  id: { h: (n) => `${n} jam`, m: (n) => `${n} menit`, sep: " " },
  hi: { h: (n) => `${n} घंटे`, m: (n) => `${n} मिनट`, sep: " " },
  th: { h: (n) => `${n} ชั่วโมง`, m: (n) => `${n} นาที`, sep: " " },
  ar: { h: (n) => `${n} ساعة`, m: (n) => `${n} دقيقة`, sep: " و" },
};

export function fmtDuration(ms: number, lang: HoldLang): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const u = UNITS[lang];
  if (h && m) return `${u.h(h)}${u.sep}${u.m(m)}`;
  return h ? u.h(h) : u.m(m);
}

export type HoldOutcome =
  /** the cache is warm right now: this request's prefix was written upstream */
  | "warmed"
  /** the warming window is held, but nothing was pre-warmed on this turn */
  | "held"
  /** held; today's warming budget is spent, so no pre-warm ping went out */
  | "held_budget"
  /** held; no provider key is registered, so warming can't run at all */
  | "held_no_key"
  | "keepalive_off"
  /** nothing cacheable in this conversation and nothing saved before */
  | "no_prefix"
  /** this provider holds its own cache — warming it would only burn budget */
  | "provider_not_warmed";

interface Replies {
  warmed: (d: string, tokens: string) => string;
  held: (d: string) => string;
  keepalive_off: () => string;
  no_prefix: () => string;
  not_warmed: () => string;
  /** appended to `held` to say why nothing was pre-warmed */
  budget: string;
  /** stands alone: without a provider key warming can never run */
  no_key: string;
}

const REPLIES: Record<HoldLang, Replies> = {
  ko: {
    warmed: (d, t) =>
      `🔥 이 대화를 바로 예열해뒀어요 (캐시 ${t}토큰). 지금부터 ${d} 동안 식지 않게 지킬게요. 일일 워밍 예산 안에서만 동작하고, 예산에 닿으면 메일로 알려드려요.`,
    held: (d) =>
      `🔥 캐시 워밍을 지금부터 ${d} 동안 유지할게요. 자리를 비우셔도 캐시가 식지 않아요. 일일 워밍 예산 안에서만 동작하고, 예산에 닿으면 메일로 알려드려요.`,
    keepalive_off: () =>
      `이 키는 캐시 워머가 꺼져 있어서 홀드를 걸 수 없어요. 콘솔 > 키 설정에서 캐시 워머를 켠 뒤 다시 말해 주세요.`,
    no_prefix: () =>
      `이 대화엔 아직 캐시로 만들 만한 분량이 없어요(시스템 프롬프트·툴이 모델의 최소 캐시 크기보다 작아요). 실제 프롬프트로 한 번 요청한 뒤 다시 말해 주시면 그 대화를 지켜드릴게요.`,
    not_warmed: () =>
      `워밍은 Anthropic 트래픽에만 걸려요. 다른 제공사는 캐시를 스스로 오래 들고 있어서(저희가 벤치마크로 확인했어요) 핑은 예산만 태우거든요. 이 경로에선 지킬 게 없어요.`,
    budget: `오늘 워밍 예산을 다 써서 지금 예열은 못 했어요 — 예산은 UTC 자정에 초기화돼요.`,
    no_key: `홀드는 기록했지만, 이 키에 모델 제공사 키가 등록돼 있지 않아 예열이 안 돼요. 콘솔에서 키를 등록해 주세요.`,
  },
  en: {
    warmed: (d, t) =>
      `🔥 Pre-warmed this conversation right now (${t} tokens cached) and holding it warm for ${d}. Warming stays within your daily budget; you'll get an email if it's reached.`,
    held: (d) =>
      `🔥 Holding your cache warm for ${d} from now. Step away — it won't go cold. Warming stays within your daily budget; you'll get an email if it's reached.`,
    keepalive_off: () =>
      `The Cache Warmer is off for this key, so a hold can't be set. Enable it in Console > key settings, then ask again.`,
    no_prefix: () =>
      `There's nothing cacheable in this conversation yet — the system prompt and tools are below the model's minimum cache size. Send one real request and ask again.`,
    not_warmed: () =>
      `Warming only applies to Anthropic traffic. We measured the other providers: their caches survive idle gaps on their own, so pings there would just burn your budget — there's nothing to hold on this path.`,
    budget: `Today's warming budget is already spent, so nothing was pre-warmed; it resets at midnight UTC.`,
    no_key: `The hold is recorded, but no provider key is registered on this key — warming can't run until you add one in the console.`,
  },
  ja: {
    warmed: (d, t) =>
      `🔥 この会話をいま予熱しました（キャッシュ${t}トークン）。これから${d}、冷めないように保温します。1日の保温予算内でのみ動作し、上限に達したらメールでお知らせします。`,
    held: (d) =>
      `🔥 これから${d}、キャッシュを保温し続けます。席を外しても冷めません。1日の保温予算内でのみ動作し、上限に達したらメールでお知らせします。`,
    keepalive_off: () =>
      `このキーはキャッシュウォーマーがオフのため、ホールドを設定できません。コンソール > キー設定でオンにしてから、もう一度どうぞ。`,
    no_prefix: () =>
      `この会話にはまだキャッシュできる分量がありません（システムプロンプトとツールがモデルの最小キャッシュサイズ未満です）。実際のリクエストを一度送ってから、もう一度どうぞ。`,
    not_warmed: () =>
      `保温はAnthropicのトラフィックにのみ適用されます。他社のキャッシュは自前で長く保持されることをベンチマークで確認しており、pingは予算を減らすだけです。この経路では保温するものがありません。`,
    budget: `本日の保温予算を使い切ったため、予熱は行いませんでした（予算はUTC0時にリセットされます）。`,
    no_key: `ホールドは記録しましたが、このキーにはモデル提供元のAPIキーが登録されていないため保温できません。コンソールで登録してください。`,
  },
  zh: {
    warmed: (d, t) =>
      `🔥 已立即为这段对话预热（缓存 ${t} tokens），并从现在起保温 ${d}。保温只在每日预算内进行，达到上限会邮件通知你。`,
    held: (d) =>
      `🔥 从现在起为你保温缓存 ${d}。放心离开 — 缓存不会冷掉。保温只在每日预算内进行，达到上限会邮件通知你。`,
    keepalive_off: () =>
      `这把密钥的缓存保温是关闭的，无法设置保温锁定。请在控制台 > 密钥设置里开启后再试一次。`,
    no_prefix: () =>
      `这段对话还没有可缓存的内容（系统提示和工具小于模型的最小缓存长度）。先发送一次真实请求，然后再说一次。`,
    not_warmed: () =>
      `保温只对 Anthropic 流量生效。我们实测过其他厂商：它们的缓存自己就能扛过空闲期，发 ping 只会白花预算 — 这条路径没有需要保温的东西。`,
    budget: `今天的保温预算已用完，所以没有预热；预算在 UTC 零点重置。`,
    no_key: `保温窗口已记录，但这把密钥没有登记模型厂商的 API 密钥，无法预热 — 请在控制台补上。`,
  },
  es: {
    warmed: (d, t) =>
      `🔥 He precalentado esta conversación ahora mismo (${t} tokens en caché) y la mantendré caliente durante ${d}. El calentamiento respeta tu presupuesto diario; te avisaremos por correo si se alcanza.`,
    held: (d) =>
      `🔥 Mantendré tu caché caliente durante ${d} a partir de ahora. Puedes ausentarte — no se enfriará. El calentamiento respeta tu presupuesto diario; te avisaremos por correo si se alcanza.`,
    keepalive_off: () =>
      `El Calentador de caché está desactivado para esta clave, así que no se puede fijar la retención. Actívalo en Consola > ajustes de la clave y vuelve a pedirlo.`,
    no_prefix: () =>
      `Todavía no hay nada que cachear en esta conversación: el prompt de sistema y las herramientas están por debajo del mínimo del modelo. Envía una petición real y vuelve a pedirlo.`,
    not_warmed: () =>
      `El calentamiento solo se aplica al tráfico de Anthropic. Medimos a los demás proveedores: sus cachés sobreviven las pausas por sí solas, así que los pings solo gastarían tu presupuesto. En esta ruta no hay nada que mantener.`,
    budget: `El presupuesto de calentamiento de hoy ya está agotado, así que no se precalentó nada; se reinicia a medianoche UTC.`,
    no_key: `La retención queda registrada, pero esta clave no tiene ninguna clave del proveedor, así que el calentamiento no puede funcionar — añádela en la consola.`,
  },
  pt: {
    warmed: (d, t) =>
      `🔥 Aqueci esta conversa agora mesmo (${t} tokens em cache) e vou mantê-la quente por ${d}. O aquecimento respeita seu orçamento diário; avisamos por e-mail se ele for atingido.`,
    held: (d) =>
      `🔥 Vou manter seu cache quente por ${d} a partir de agora. Pode se ausentar — ele não vai esfriar. O aquecimento respeita seu orçamento diário; avisamos por e-mail se ele for atingido.`,
    keepalive_off: () =>
      `O Aquecedor de cache está desligado para esta chave, então não é possível fixar a retenção. Ative em Console > configurações da chave e peça de novo.`,
    no_prefix: () =>
      `Ainda não há nada para armazenar em cache nesta conversa — o prompt de sistema e as ferramentas estão abaixo do mínimo do modelo. Envie uma requisição real e peça de novo.`,
    not_warmed: () =>
      `O aquecimento só se aplica ao tráfego da Anthropic. Medimos os outros provedores: os caches deles sobrevivem às pausas por conta própria, então pings só gastariam seu orçamento. Nesta rota não há nada para manter.`,
    budget: `O orçamento de aquecimento de hoje já acabou, então nada foi pré-aquecido; ele reinicia à meia-noite UTC.`,
    no_key: `A retenção fica registrada, mas esta chave não tem nenhuma chave do provedor, então o aquecimento não roda — cadastre uma no console.`,
  },
  fr: {
    warmed: (d, t) =>
      `🔥 J'ai préchauffé cette conversation à l'instant (${t} tokens en cache) et je la garde chaude pendant ${d}. Le préchauffage reste dans votre budget quotidien ; vous recevrez un e-mail s'il est atteint.`,
    held: (d) =>
      `🔥 Je garde votre cache chaud pendant ${d} à partir de maintenant. Éloignez-vous — il ne refroidira pas. Le préchauffage reste dans votre budget quotidien ; vous recevrez un e-mail s'il est atteint.`,
    keepalive_off: () =>
      `Le Réchauffeur de cache est désactivé pour cette clé, impossible de fixer un maintien. Activez-le dans Console > paramètres de la clé, puis redemandez.`,
    no_prefix: () =>
      `Il n'y a encore rien à mettre en cache dans cette conversation : le prompt système et les outils sont sous le minimum du modèle. Envoyez une vraie requête, puis redemandez.`,
    not_warmed: () =>
      `Le préchauffage ne concerne que le trafic Anthropic. Nous avons mesuré les autres fournisseurs : leurs caches survivent seuls aux pauses, donc les pings ne feraient que consommer votre budget. Rien à maintenir sur cette route.`,
    budget: `Le budget de préchauffage du jour est épuisé, donc rien n'a été préchauffé ; il repart à minuit UTC.`,
    no_key: `Le maintien est enregistré, mais aucune clé de fournisseur n'est associée à cette clé — le préchauffage ne peut pas tourner tant que vous ne l'ajoutez pas dans la console.`,
  },
  de: {
    warmed: (d, t) =>
      `🔥 Ich habe diese Unterhaltung gerade vorgewärmt (${t} Tokens im Cache) und halte sie ${d} lang warm. Das Warmhalten bleibt in deinem Tagesbudget; bei Erreichen bekommst du eine E-Mail.`,
    held: (d) =>
      `🔥 Ich halte deinen Cache ab jetzt ${d} lang warm. Geh ruhig weg — er wird nicht kalt. Das Warmhalten bleibt in deinem Tagesbudget; bei Erreichen bekommst du eine E-Mail.`,
    keepalive_off: () =>
      `Der Cache-Wärmer ist für diesen Key aus, daher lässt sich kein Halten setzen. Schalte ihn in Konsole > Key-Einstellungen ein und frag noch einmal.`,
    no_prefix: () =>
      `In dieser Unterhaltung gibt es noch nichts zu cachen — System-Prompt und Tools liegen unter der Mindestgröße des Modells. Schick eine echte Anfrage und frag danach noch einmal.`,
    not_warmed: () =>
      `Warmhalten gilt nur für Anthropic-Traffic. Wir haben die anderen Anbieter gemessen: deren Caches überleben Pausen von allein, Pings würden nur Budget verbrennen. Auf diesem Pfad gibt es nichts zu halten.`,
    budget: `Das heutige Warmhalte-Budget ist schon aufgebraucht, deshalb wurde nichts vorgewärmt; es setzt um Mitternacht UTC zurück.`,
    no_key: `Das Halten ist vermerkt, aber auf diesem Key liegt kein Anbieter-Key — ohne ihn kann nicht gewärmt werden. Trag ihn in der Konsole ein.`,
  },
  it: {
    warmed: (d, t) =>
      `🔥 Ho preriscaldato questa conversazione adesso (${t} token in cache) e la tengo calda per ${d}. Il riscaldamento resta nel budget giornaliero; se viene raggiunto ti avvisiamo per email.`,
    held: (d) =>
      `🔥 Tengo la tua cache calda per ${d} da adesso. Allontanati tranquillo — non si raffredderà. Il riscaldamento resta nel budget giornaliero; se viene raggiunto ti avvisiamo per email.`,
    keepalive_off: () =>
      `Il Riscaldatore di cache è disattivato per questa chiave, quindi non posso impostare il mantenimento. Attivalo in Console > impostazioni della chiave e richiedilo di nuovo.`,
    no_prefix: () =>
      `In questa conversazione non c'è ancora nulla da mettere in cache: prompt di sistema e strumenti sono sotto il minimo del modello. Invia una richiesta reale e richiedilo.`,
    not_warmed: () =>
      `Il riscaldamento vale solo per il traffico Anthropic. Abbiamo misurato gli altri provider: le loro cache sopravvivono alle pause da sole, quindi i ping brucerebbero solo budget. Su questa rotta non c'è nulla da mantenere.`,
    budget: `Il budget di riscaldamento di oggi è esaurito, quindi non ho preriscaldato nulla; si azzera a mezzanotte UTC.`,
    no_key: `Il mantenimento è registrato, ma questa chiave non ha nessuna chiave del provider, quindi il riscaldamento non può partire — aggiungila in console.`,
  },
  ru: {
    warmed: (d, t) =>
      `🔥 Я прогрел этот диалог прямо сейчас (${t} токенов в кэше) и продержу его тёплым ${d}. Прогрев идёт только в рамках дневного бюджета; при его исчерпании придёт письмо.`,
    held: (d) =>
      `🔥 Держу кэш тёплым ${d} с этого момента. Можно отойти — он не остынет. Прогрев идёт только в рамках дневного бюджета; при его исчерпании придёт письмо.`,
    keepalive_off: () =>
      `Для этого ключа прогрев кэша выключен, поэтому удержание не поставить. Включите его в Консоли > настройки ключа и попросите снова.`,
    no_prefix: () =>
      `В этом диалоге пока нечего кэшировать — системный промпт и инструменты меньше минимального размера кэша у модели. Отправьте один настоящий запрос и попросите снова.`,
    not_warmed: () =>
      `Прогрев работает только для трафика Anthropic. Мы измерили остальных провайдеров: их кэш сам переживает простои, так что пинги только сожгут бюджет. На этом пути держать нечего.`,
    budget: `Дневной бюджет прогрева уже израсходован, поэтому прогрев не выполнен; он обнулится в полночь UTC.`,
    no_key: `Удержание записано, но к этому ключу не привязан ключ провайдера — без него прогрев не запустится. Добавьте его в консоли.`,
  },
  tr: {
    warmed: (d, t) =>
      `🔥 Bu konuşmayı hemen ısıttım (${t} token önbellekte) ve ${d} boyunca sıcak tutacağım. Isıtma günlük bütçenin içinde kalır; bütçeye ulaşılırsa e-posta gönderiyoruz.`,
    held: (d) =>
      `🔥 Önbelleğini şu andan itibaren ${d} boyunca sıcak tutuyorum. Rahatça uzaklaş — soğumayacak. Isıtma günlük bütçenin içinde kalır; bütçeye ulaşılırsa e-posta gönderiyoruz.`,
    keepalive_off: () =>
      `Bu anahtarda Önbellek Isıtıcı kapalı, bu yüzden tutma ayarlanamıyor. Konsol > anahtar ayarlarından açıp tekrar isteyin.`,
    no_prefix: () =>
      `Bu konuşmada henüz önbelleğe alınacak bir şey yok — sistem istemi ve araçlar modelin en küçük önbellek boyutunun altında. Bir gerçek istek gönderip tekrar söyleyin.`,
    not_warmed: () =>
      `Isıtma yalnızca Anthropic trafiği için geçerli. Diğer sağlayıcıları ölçtük: önbellekleri boşta kalma aralıklarını kendiliğinden atlatıyor, ping atmak sadece bütçe yakar. Bu yolda tutulacak bir şey yok.`,
    budget: `Bugünün ısıtma bütçesi tükendi, bu yüzden ön ısıtma yapılmadı; bütçe UTC gece yarısı sıfırlanır.`,
    no_key: `Tutma kaydedildi, ama bu anahtara bir sağlayıcı anahtarı kayıtlı değil — o olmadan ısıtma çalışamaz. Konsoldan ekleyin.`,
  },
  vi: {
    warmed: (d, t) =>
      `🔥 Đã làm nóng cuộc hội thoại này ngay bây giờ (${t} token trong cache) và sẽ giữ nóng trong ${d}. Việc làm nóng luôn nằm trong ngân sách mỗi ngày; nếu đạt hạn mức chúng tôi sẽ gửi email.`,
    held: (d) =>
      `🔥 Tôi sẽ giữ cache của bạn nóng trong ${d} kể từ bây giờ. Cứ rời máy — nó sẽ không nguội. Việc làm nóng luôn nằm trong ngân sách mỗi ngày; nếu đạt hạn mức chúng tôi sẽ gửi email.`,
    keepalive_off: () =>
      `Bộ làm nóng cache đang tắt cho khóa này nên không đặt được giữ nóng. Hãy bật ở Console > cài đặt khóa rồi nhắc lại.`,
    no_prefix: () =>
      `Cuộc hội thoại này chưa có gì để cache — system prompt và tools nhỏ hơn kích thước cache tối thiểu của mô hình. Hãy gửi một yêu cầu thật rồi nhắc lại.`,
    not_warmed: () =>
      `Việc làm nóng chỉ áp dụng cho lưu lượng Anthropic. Chúng tôi đã đo các nhà cung cấp khác: cache của họ tự sống qua các khoảng nghỉ, nên ping chỉ tốn ngân sách. Trên đường này không có gì để giữ.`,
    budget: `Ngân sách làm nóng hôm nay đã hết nên chưa làm nóng trước; ngân sách reset vào nửa đêm UTC.`,
    no_key: `Đã ghi nhận việc giữ nóng, nhưng khóa này chưa đăng ký khóa của nhà cung cấp — chưa có nó thì không làm nóng được. Hãy thêm trong console.`,
  },
  id: {
    warmed: (d, t) =>
      `🔥 Percakapan ini baru saja saya panaskan (${t} token di cache) dan akan saya jaga hangat selama ${d}. Pemanasan tetap di dalam anggaran harian; kalau tercapai kami kirim email.`,
    held: (d) =>
      `🔥 Cache kamu saya jaga hangat selama ${d} dari sekarang. Silakan pergi — tidak akan dingin. Pemanasan tetap di dalam anggaran harian; kalau tercapai kami kirim email.`,
    keepalive_off: () =>
      `Pemanas Cache mati untuk kunci ini, jadi penahanan tidak bisa dipasang. Nyalakan di Console > pengaturan kunci, lalu minta lagi.`,
    no_prefix: () =>
      `Belum ada yang bisa di-cache di percakapan ini — system prompt dan tools masih di bawah ukuran cache minimum model. Kirim satu permintaan sungguhan lalu minta lagi.`,
    not_warmed: () =>
      `Pemanasan hanya berlaku untuk trafik Anthropic. Kami mengukur penyedia lain: cache mereka bertahan sendiri melewati jeda, jadi ping hanya menghabiskan anggaran. Di jalur ini tidak ada yang perlu dijaga.`,
    budget: `Anggaran pemanasan hari ini sudah habis, jadi tidak ada yang dipanaskan; anggaran direset tengah malam UTC.`,
    no_key: `Penahanan sudah dicatat, tapi kunci ini belum punya kunci penyedia model — tanpa itu pemanasan tidak bisa jalan. Tambahkan di console.`,
  },
  hi: {
    warmed: (d, t) =>
      `🔥 इस बातचीत को अभी गर्म कर दिया (${t} टोकन कैश में) और ${d} तक गर्म रखूँगा। वॉर्मिंग रोज़ के बजट के भीतर ही चलती है; बजट पूरा होने पर ईमेल भेज देंगे।`,
    held: (d) =>
      `🔥 अब से ${d} तक आपका कैश गर्म रखूँगा। बेफ़िक्र जाइए — यह ठंडा नहीं होगा। वॉर्मिंग रोज़ के बजट के भीतर ही चलती है; बजट पूरा होने पर ईमेल भेज देंगे।`,
    keepalive_off: () =>
      `इस की के लिए कैश वॉर्मर बंद है, इसलिए होल्ड नहीं लगाया जा सकता। कंसोल > की सेटिंग्स में इसे चालू करके फिर कहें।`,
    no_prefix: () =>
      `इस बातचीत में अभी कैश करने लायक कुछ नहीं है — सिस्टम प्रॉम्प्ट और टूल्स मॉडल के न्यूनतम कैश आकार से छोटे हैं। एक असली रिक्वेस्ट भेजकर फिर कहें।`,
    not_warmed: () =>
      `वॉर्मिंग सिर्फ़ Anthropic ट्रैफ़िक पर लागू होती है। बाकी प्रोवाइडर हमने नापे हैं — उनका कैश खाली अंतराल खुद झेल लेता है, इसलिए पिंग सिर्फ़ बजट जलाएँगे। इस रास्ते पर रखने जैसा कुछ नहीं है।`,
    budget: `आज का वॉर्मिंग बजट खत्म हो गया है, इसलिए अभी गर्म नहीं किया; बजट UTC आधी रात को रीसेट होता है।`,
    no_key: `होल्ड दर्ज कर लिया, लेकिन इस की पर कोई प्रोवाइडर की नहीं है — उसके बिना वॉर्मिंग नहीं चलेगी। कंसोल में जोड़ें।`,
  },
  th: {
    warmed: (d, t) =>
      `🔥 อุ่นบทสนทนานี้ให้แล้วเมื่อสักครู่ (แคช ${t} โทเคน) และจะรักษาความร้อนไว้ ${d} การอุ่นทำงานภายในงบประมาณต่อวันเท่านั้น ถ้าถึงเพดานเราจะส่งอีเมลแจ้ง`,
    held: (d) =>
      `🔥 จะรักษาแคชของคุณให้อุ่นไว้ ${d} นับจากนี้ ออกไปได้เลย — แคชจะไม่เย็น การอุ่นทำงานภายในงบประมาณต่อวันเท่านั้น ถ้าถึงเพดานเราจะส่งอีเมลแจ้ง`,
    keepalive_off: () =>
      `คีย์นี้ปิดตัวอุ่นแคชอยู่ จึงตั้งการรักษาความร้อนไม่ได้ เปิดที่ Console > ตั้งค่าคีย์ แล้วบอกอีกครั้ง`,
    no_prefix: () =>
      `บทสนทนานี้ยังไม่มีอะไรที่แคชได้ — system prompt และ tools เล็กกว่าขนาดแคชขั้นต่ำของโมเดล ส่งคำขอจริงหนึ่งครั้งแล้วบอกอีกครั้ง`,
    not_warmed: () =>
      `การอุ่นใช้ได้กับทราฟฟิกของ Anthropic เท่านั้น เราวัดผู้ให้บริการรายอื่นแล้ว แคชของพวกเขาอยู่รอดช่วงว่างได้เอง การส่ง ping จึงแค่เปลืองงบ เส้นทางนี้ไม่มีอะไรต้องรักษา`,
    budget: `งบประมาณการอุ่นของวันนี้ใช้หมดแล้ว จึงยังไม่ได้อุ่นล่วงหน้า งบจะรีเซ็ตเที่ยงคืน UTC`,
    no_key: `บันทึกการรักษาความร้อนไว้แล้ว แต่คีย์นี้ยังไม่ได้ผูกคีย์ของผู้ให้บริการโมเดล — ถ้ายังไม่มีจะอุ่นไม่ได้ เพิ่มในคอนโซลก่อน`,
  },
  ar: {
    warmed: (d, t) =>
      `🔥 سخّنت هذه المحادثة الآن (${t} توكن في الذاكرة المؤقتة) وسأبقيها دافئة لمدة ${d}. التسخين يبقى داخل ميزانيتك اليومية، وسنراسلك بالبريد إذا وصلت إليها.`,
    held: (d) =>
      `🔥 سأبقي الذاكرة المؤقتة دافئة لمدة ${d} من الآن. اذهب بأمان — لن تبرد. التسخين يبقى داخل ميزانيتك اليومية، وسنراسلك بالبريد إذا وصلت إليها.`,
    keepalive_off: () =>
      `مُسخِّن الذاكرة المؤقتة مُعطَّل لهذا المفتاح، لذا لا يمكن تثبيت التسخين. فعّله من Console > إعدادات المفتاح ثم اطلب مرة أخرى.`,
    no_prefix: () =>
      `لا يوجد بعد ما يمكن تخزينه في هذه المحادثة — تعليمات النظام والأدوات أصغر من الحد الأدنى للتخزين في هذا الموديل. أرسل طلبًا حقيقيًا واحدًا ثم اطلب مرة أخرى.`,
    not_warmed: () =>
      `التسخين ينطبق على حركة Anthropic فقط. قِسنا المزودين الآخرين: ذاكرتهم المؤقتة تصمد وحدها خلال فترات الخمول، لذا فإن الـ ping يستهلك ميزانيتك دون فائدة. لا شيء لتثبيته في هذا المسار.`,
    budget: `ميزانية التسخين لهذا اليوم انتهت، لذلك لم يتم التسخين المسبق؛ تُصفَّر في منتصف الليل بتوقيت UTC.`,
    no_key: `تم تسجيل التثبيت، لكن هذا المفتاح لا يحتوي على مفتاح مزوّد الموديل — بدونه لا يمكن التسخين. أضفه من الكونسول.`,
  },
};

/** Reply text for a cache command, in the language it was asked in.
 *  `tokens` = how many tokens are actually cached upstream (measured from the
 *  pre-warm ping's usage), so the number we quote is never a guess. */
export function holdReplyText(
  outcome: HoldOutcome, ms: number, lang: HoldLang, tokens = 0
): string {
  const r = REPLIES[lang];
  const d = fmtDuration(ms, lang);
  switch (outcome) {
    case "warmed":
      return r.warmed(d, tokens.toLocaleString("en-US"));
    case "held":
      return r.held(d);
    case "held_budget":
      return `${r.held(d)} ${r.budget}`;
    case "held_no_key":
      return r.no_key;
    case "keepalive_off":
      return r.keepalive_off();
    case "no_prefix":
      return r.no_prefix();
    case "provider_not_warmed":
      return r.not_warmed();
  }
}
