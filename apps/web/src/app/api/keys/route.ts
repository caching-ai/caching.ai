import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { generateApiKey, sha256Hex } from "@caching/shared";

export async function GET() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { rows } = await db().query(
    `SELECT id, name, key_prefix_display, auto_cache_control, keepalive_enabled,
            keepalive_budget_usd_daily, anthropic_cache_ttl, openai_cache_retention,
            keepalive_hold_until, cache_tuning_mode, created_at, revoked_at,
            (anthropic_key_encrypted IS NOT NULL) AS has_anthropic_key,
            (openai_key_encrypted IS NOT NULL) AS has_openai_key,
            (gemini_key_encrypted IS NOT NULL) AS has_gemini_key,
            (grok_key_encrypted IS NOT NULL) AS has_grok_key
       FROM api_keys WHERE user_id=$1 ORDER BY id DESC`,
    [sess.uid]
  );
  // adaptive tuning is a hosted-cloud feature (ee/) — the UI only offers it
  // when the deployment opts in
  return NextResponse.json({ keys: rows, cloud: process.env.CACHING_CLOUD === "1" });
}

export async function POST(req: Request) {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { name, mode } = await req.json().catch(() => ({}));
  if (mode !== undefined && mode !== "optimize" && mode !== "observe") {
    return NextResponse.json({ error: "mode must be 'optimize' or 'observe'." }, { status: 400 });
  }
  const raw = generateApiKey();
  const display = raw.slice(0, 11) + "…" + raw.slice(-4);
  // observe = shadow preset: meter and diagnose only, never modify a request.
  // Keep-alive and auto-tune already default to off; injection is the one flag
  // to clear. Flip any switch on later and the key leaves observe mode.
  const { rows } = await db().query(
    `INSERT INTO api_keys(user_id, name, key_hash, key_prefix_display, auto_cache_control)
     VALUES($1,$2,$3,$4,$5) RETURNING id, name, key_prefix_display, created_at`,
    [sess.uid, (name || "default").slice(0, 64), sha256Hex(raw), display, mode !== "observe"]
  );
  // plaintext returned exactly once
  return NextResponse.json({ key: rows[0], plaintext: raw });
}
