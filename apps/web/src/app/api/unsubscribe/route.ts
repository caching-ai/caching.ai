import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deriveTokenSecret, verifySession } from "@caching/shared";

// One-click unsubscribe from report emails. GET serves a tiny confirmation
// page (link in the email footer); POST satisfies RFC 8058 one-click
// (List-Unsubscribe-Post) — both flip the same flag.

async function unsubscribe(req: Request): Promise<boolean> {
  const enc = process.env.ENCRYPTION_KEY;
  if (!enc) return false;
  const secret = deriveTokenSecret(enc);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const payload = verifySession<{ uid: number; kind: string }>(token, secret);
  if (!payload || payload.kind !== "unsub") return false;
  await db().query("UPDATE users SET report_opt_out=true WHERE id=$1", [payload.uid]);
  return true;
}

export async function GET(req: Request) {
  const ok = await unsubscribe(req);
  const html = ok
    ? `<h1>Unsubscribed</h1><p>You won't receive report emails anymore. / 이제 리포트 메일을 보내지 않아요.</p>`
    : `<h1>Link expired</h1><p>This unsubscribe link is not valid. / 링크가 유효하지 않아요.</p>`;
  return new Response(
    `<!doctype html><html><body style="font-family:Inter,system-ui,sans-serif;max-width:480px;margin:80px auto;color:#363636;">${html}</body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export async function POST(req: Request) {
  const ok = await unsubscribe(req);
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}
