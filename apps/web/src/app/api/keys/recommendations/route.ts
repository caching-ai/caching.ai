import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/org";
import { recommendForKey, type KeyRecommendation } from "@caching/ee-adaptive";

interface Decision {
  setting: string;
  old_value: string | null;
  new_value: string;
  reason: any;
  created_at: string;
}

/**
 * Cloud-only (ee/): per-key cache-tuning recommendations for the console —
 * one call for all of the user's keys, so the keys page never fans out.
 */
export async function GET() {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const sess = ws.session;
  if (process.env.CACHING_CLOUD !== "1") {
    return NextResponse.json({ cloud: false, recs: {} });
  }

  const { rows: keys } = await db().query<{ id: number; keepalive_enabled: boolean }>(
    `SELECT id, keepalive_enabled FROM api_keys
      WHERE user_id=$1 AND ${ws.org ? "org_id = $2" : "org_id IS NULL"}
        AND revoked_at IS NULL AND auto_cache_control = true
      ORDER BY id DESC LIMIT 25`,
    ws.org ? [sess.uid, ws.org.orgId] : [sess.uid]
  );

  const recs: Record<number, KeyRecommendation & { lastDecision?: Decision }> = {};
  for (const k of keys) {
    try {
      recs[k.id] = await recommendForKey(db(), k.id, k.keepalive_enabled);
    } catch {
      // analysis is best-effort; the console just shows nothing for this key
    }
  }

  if (keys.length) {
    const { rows: decisions } = await db().query<Decision & { api_key_id: number }>(
      `SELECT DISTINCT ON (api_key_id)
              api_key_id, setting, old_value, new_value, reason, created_at
         FROM tuning_decisions
        WHERE api_key_id = ANY($1)
        ORDER BY api_key_id, created_at DESC`,
      [keys.map((k) => k.id)]
    );
    for (const d of decisions) {
      if (recs[d.api_key_id]) recs[d.api_key_id].lastDecision = d;
    }
  }

  return NextResponse.json({ cloud: true, recs });
}
