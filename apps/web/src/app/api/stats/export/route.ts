import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/org";

const WINDOWS = [7, 30, 90];
const MAX_ROWS = 10000;

const HEADER = [
  "timestamp", "provider", "model", "status", "latency_ms",
  "input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens",
  "cost_usd", "saved_usd", "is_keepalive", "cache_breaker_detected",
];

// Cells are numbers, ISO dates, booleans, or model/provider slugs — quoting
// covers the odd model name with a comma; nothing here can start with =+-@.
const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Raw request log download (per-request rows, newest first, capped). */
export async function GET(req: NextRequest) {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const sess = ws.session;

  const days = Number(req.nextUrl.searchParams.get("days") ?? 30);
  if (!WINDOWS.includes(days)) {
    return NextResponse.json({ error: "days must be 7, 30 or 90." }, { status: 400 });
  }

  const rows = await db().query(
    `SELECT rl.ts, rl.provider, rl.model, rl.status, rl.latency_ms,
            rl.input_tokens, rl.output_tokens, rl.cache_read_tokens, rl.cache_creation_tokens,
            rl.cost_usd::float AS cost_usd, rl.saved_usd::float AS saved_usd,
            rl.is_keepalive, rl.cache_breaker_detected
       FROM request_logs rl
       JOIN api_keys k ON k.id = rl.api_key_id
      WHERE k.user_id = $1 AND ts > now() - make_interval(days => $2)
        AND ${ws.org ? "k.org_id = $4" : "k.org_id IS NULL"}
      ORDER BY rl.ts DESC LIMIT $3`,
    ws.org ? [sess.uid, days, MAX_ROWS, ws.org.orgId] : [sess.uid, days, MAX_ROWS]
  );

  const lines = [HEADER.join(",")];
  for (const r of rows.rows) {
    lines.push([
      new Date(r.ts).toISOString(), r.provider, r.model, r.status, r.latency_ms,
      r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_creation_tokens,
      r.cost_usd, r.saved_usd, r.is_keepalive, r.cache_breaker_detected,
    ].map(cell).join(","));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="caching-ai-requests-${days}d-${stamp}.csv"`,
    },
  });
}
