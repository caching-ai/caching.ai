import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/org";

// Prefix Optimizer: which prompt block (system / tools / first message)
// actually changes between requests, measured over the last 7 days of real
// traffic. A block that hashes differently on most requests is what's
// breaking the cache.
export async function GET() {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const sess = ws.session;

  const { rows } = await db().query(
    `SELECT rl.provider, rl.model, b->>'block' AS block,
            count(*)::int AS samples,
            count(DISTINCT b->>'hash')::int AS variants
       FROM request_logs rl
       JOIN api_keys k ON k.id = rl.api_key_id
      CROSS JOIN LATERAL jsonb_array_elements(rl.prefix_block_hashes) b
      WHERE k.user_id = $1
        AND ${ws.org ? "k.org_id = $2" : "k.org_id IS NULL"}
        AND rl.ts > now() - interval '7 days'
        AND rl.prefix_block_hashes IS NOT NULL
        AND NOT rl.is_keepalive
      GROUP BY rl.provider, rl.model, b->>'block'
     HAVING count(*) >= 5
      ORDER BY count(DISTINCT b->>'hash')::float / count(*) DESC`,
    ws.org ? [sess.uid, ws.org.orgId] : [sess.uid]
  );

  const blocks = rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    block: r.block,
    samples: r.samples,
    // 1 variant across N samples = perfectly stable (rate 0);
    // N variants across N samples = changes every request (rate 1)
    changeRate: r.samples > 1 ? (r.variants - 1) / (r.samples - 1) : 0,
  }));
  return NextResponse.json({ blocks });
}
