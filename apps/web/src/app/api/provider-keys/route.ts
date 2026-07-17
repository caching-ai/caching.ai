import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { encrypt } from "@caching/shared";

// Account-level provider keys (the default for every ck_ key the user mints).
const PROVIDERS: Record<string, { prefix: string | null; label: string }> = {
  anthropic: { prefix: "sk-ant-", label: "an Anthropic API key (sk-ant-…)" },
  openai: { prefix: "sk-", label: "an OpenAI API key (sk-…)" },
  gemini: { prefix: null, label: "a Gemini API key" },
  grok: { prefix: "xai-", label: "an xAI API key (xai-…)" },
};

export async function GET() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { rows } = await db().query(
    "SELECT provider, updated_at FROM user_provider_keys WHERE user_id=$1",
    [sess.uid]
  );
  const registered = Object.fromEntries(rows.map((r) => [r.provider, r.updated_at]));
  return NextResponse.json({ registered });
}

export async function PATCH(req: Request) {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const provider = String(body.provider ?? "");
  const spec = PROVIDERS[provider];
  if (!spec) return NextResponse.json({ error: "Unknown provider." }, { status: 400 });

  if (body.remove === true) {
    await db().query("DELETE FROM user_provider_keys WHERE user_id=$1 AND provider=$2", [
      sess.uid,
      provider,
    ]);
    return NextResponse.json({ ok: true });
  }

  const key = body.key;
  if (typeof key !== "string" || key.length === 0) {
    return NextResponse.json({ error: "Key is required." }, { status: 400 });
  }
  if (spec.prefix && !key.startsWith(spec.prefix)) {
    return NextResponse.json({ error: `That doesn't look like ${spec.label}.` }, { status: 400 });
  }
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });

  await db().query(
    `INSERT INTO user_provider_keys(user_id, provider, key_encrypted, updated_at)
     VALUES($1,$2,$3,now())
     ON CONFLICT (user_id, provider) DO UPDATE SET key_encrypted=$3, updated_at=now()`,
    [sess.uid, provider, encrypt(key, encKey)]
  );
  return NextResponse.json({ ok: true });
}
