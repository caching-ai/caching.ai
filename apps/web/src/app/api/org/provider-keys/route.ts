import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encrypt } from "@caching/shared";
import { audit, requireOrgAdmin, requireOrgMember } from "@/lib/org";

// Workspace provider keys (org BYOK): the shared provider account every org
// ck_ key uses — and the reason teammates' caches warm each other. Admin-only
// to write; any member may see WHICH providers are connected (not the keys).
const PROVIDERS: Record<string, { prefix: string | null; label: string }> = {
  anthropic: { prefix: "sk-ant-", label: "an Anthropic API key (sk-ant-…)" },
  openai: { prefix: "sk-", label: "an OpenAI API key (sk-…)" },
  gemini: { prefix: null, label: "a Gemini API key" },
  grok: { prefix: "xai-", label: "an xAI API key (xai-…)" },
};

export async function GET() {
  const r = await requireOrgMember();
  if ("error" in r) return r.error;
  const { rows } = await db().query(
    "SELECT provider, updated_at FROM org_provider_keys WHERE org_id=$1", [r.org.orgId]);
  const registered = Object.fromEntries(rows.map((row) => [row.provider, row.updated_at]));
  return NextResponse.json({ registered });
}

export async function PATCH(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const body = await req.json().catch(() => ({}));

  const provider = String(body.provider ?? "");
  const spec = PROVIDERS[provider];
  if (!spec) return NextResponse.json({ error: "Unknown provider." }, { status: 400 });

  if (body.remove === true) {
    await db().query(
      "DELETE FROM org_provider_keys WHERE org_id=$1 AND provider=$2", [r.org.orgId, provider]);
    await audit(r.org.orgId, r.ws.session, "provider_key.remove", provider);
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
    `INSERT INTO org_provider_keys(org_id, provider, key_encrypted, updated_at)
     VALUES($1,$2,$3,now())
     ON CONFLICT (org_id, provider) DO UPDATE SET key_encrypted=$3, updated_at=now()`,
    [r.org.orgId, provider, encrypt(key, encKey)]
  );
  await audit(r.org.orgId, r.ws.session, "provider_key.set", provider);
  return NextResponse.json({ ok: true });
}
