import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clearedCookie, getSession } from "@/lib/auth";

/**
 * Self-serve account deletion (Privacy Policy §4/§7). Personal data is
 * removed or anonymized immediately:
 *  - keep-alive prefixes, provider keys, payment methods: deleted
 *  - api keys: revoked and their per-key provider overrides cleared
 *  - the user row: email replaced with an opaque tombstone, password cleared
 * request_logs stay (token counts only — no personal content) so past billing
 * periods remain auditable, as the policy states for billing records. Raw
 * rows older than LOG_RETENTION_DAYS are rolled up into request_logs_daily
 * by the proxy — day-level aggregates carry that audit trail from then on.
 */
export async function DELETE() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM keepalive_state ks USING api_keys k
        WHERE ks.api_key_id = k.id AND k.user_id = $1`,
      [sess.uid]
    );
    await client.query("DELETE FROM user_provider_keys WHERE user_id=$1", [sess.uid]);
    await client.query("DELETE FROM payment_methods WHERE user_id=$1", [sess.uid]);
    await client.query(
      `UPDATE api_keys
          SET revoked_at = COALESCE(revoked_at, now()),
              anthropic_key_encrypted = NULL, openai_key_encrypted = NULL,
              gemini_key_encrypted = NULL, grok_key_encrypted = NULL
        WHERE user_id = $1`,
      [sess.uid]
    );
    await client.query(
      `UPDATE users
          SET email = 'deleted-' || id || '@users.invalid',
              password_hash = 'deleted',
              email_verified_at = NULL,
              report_opt_out = true
        WHERE id = $1`,
      [sess.uid]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("account deletion failed:", (e as Error).message);
    return NextResponse.json({ error: "Deletion failed. Please try again." }, { status: 500 });
  } finally {
    client.release();
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearedCookie());
  return res;
}
