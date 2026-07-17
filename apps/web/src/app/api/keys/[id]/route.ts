import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { encrypt } from "@caching/shared";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const { rows } = await db().query("SELECT id FROM api_keys WHERE id=$1 AND user_id=$2", [
    id,
    sess.uid,
  ]);
  if (!rows[0]) return NextResponse.json({ error: "Key not found." }, { status: 404 });

  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;

  if (typeof body.auto_cache_control === "boolean") {
    sets.push(`auto_cache_control=$${i++}`);
    vals.push(body.auto_cache_control);
  }
  if (typeof body.keepalive_enabled === "boolean") {
    sets.push(`keepalive_enabled=$${i++}`);
    vals.push(body.keepalive_enabled);
  }
  if (body.anthropic_cache_ttl !== undefined) {
    if (body.anthropic_cache_ttl !== "5m" && body.anthropic_cache_ttl !== "1h") {
      return NextResponse.json({ error: "Cache TTL must be 5m or 1h." }, { status: 400 });
    }
    sets.push(`anthropic_cache_ttl=$${i++}`);
    vals.push(body.anthropic_cache_ttl);
  }
  if (body.openai_cache_retention !== undefined) {
    if (body.openai_cache_retention !== "default" && body.openai_cache_retention !== "24h") {
      return NextResponse.json({ error: "Cache retention must be default or 24h." }, { status: 400 });
    }
    sets.push(`openai_cache_retention=$${i++}`);
    vals.push(body.openai_cache_retention);
  }
  if (body.cache_tuning_mode !== undefined) {
    if (body.cache_tuning_mode !== "manual" && body.cache_tuning_mode !== "auto") {
      return NextResponse.json({ error: "Tuning mode must be manual or auto." }, { status: 400 });
    }
    if (body.cache_tuning_mode === "auto" && process.env.CACHING_CLOUD !== "1") {
      return NextResponse.json(
        { error: "Auto-tuning is available on the hosted Caching.ai cloud." },
        { status: 400 }
      );
    }
    sets.push(`cache_tuning_mode=$${i++}`);
    vals.push(body.cache_tuning_mode);
  }
  if (body.keepalive_budget_usd_daily !== undefined) {
    const b = Number(body.keepalive_budget_usd_daily);
    if (!Number.isFinite(b) || b < 0 || b > 1000) {
      return NextResponse.json({ error: "Daily budget must be between $0 and $1000." }, { status: 400 });
    }
    sets.push(`keepalive_budget_usd_daily=$${i++}`);
    vals.push(b);
  }
  const providerKeys: [field: string, column: string, prefix: string | null, label: string][] = [
    ["anthropic_key", "anthropic_key_encrypted", "sk-ant-", "an Anthropic API key (sk-ant-…)"],
    ["openai_key", "openai_key_encrypted", "sk-", "an OpenAI API key (sk-…)"],
    ["gemini_key", "gemini_key_encrypted", null, "a Gemini API key"],
    ["grok_key", "grok_key_encrypted", "xai-", "an xAI API key (xai-…)"],
  ];
  for (const [field, column, prefix, label] of providerKeys) {
    const v = body[field];
    if (typeof v !== "string" || v.length === 0) continue;
    if (prefix && !v.startsWith(prefix)) {
      return NextResponse.json({ error: `That doesn't look like ${label}.` }, { status: 400 });
    }
    const encKey = process.env.ENCRYPTION_KEY;
    if (!encKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
    sets.push(`${column}=$${i++}`);
    vals.push(encrypt(v, encKey));
  }
  // clear a per-key override so the account-level key applies again
  if (typeof body.remove_provider === "string") {
    const col = providerKeys.find(([f]) => f === `${body.remove_provider}_key`)?.[1];
    if (!col) return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
    sets.push(`${col}=NULL`);
  }
  if (body.revoke === true) {
    sets.push(`revoked_at=now()`);
  }
  if (!sets.length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  vals.push(id, sess.uid);
  await db().query(
    `UPDATE api_keys SET ${sets.join(", ")} WHERE id=$${i++} AND user_id=$${i}`,
    vals
  );
  // privacy: the encrypted keep-alive prefix is only kept while the feature is
  // on — turning it off (or revoking the key) deletes it immediately
  if (body.keepalive_enabled === false || body.revoke === true) {
    await db().query("DELETE FROM keepalive_state WHERE api_key_id=$1", [id]);
  }
  return NextResponse.json({ ok: true });
}
