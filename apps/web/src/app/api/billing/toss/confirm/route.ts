import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, membershipOf } from "@/lib/org";
import { encrypt } from "@caching/shared";

/**
 * Toss Payments billing-key flow: the SDK's requestBillingAuth() redirects
 * here with customerKey + authKey; we exchange authKey for a billingKey and
 * store it encrypted. The billing key alone can charge the card, so it gets
 * the same AES-256-GCM treatment as provider API keys.
 *
 * The customerKey encodes the workspace: cai-<uid> (personal) or
 * cai-org-<orgId> (team card — must be an admin of exactly that org).
 */
export async function GET(req: Request) {
  const base = process.env.PUBLIC_BASE_URL ?? "https://caching.ai";
  const fail = () => NextResponse.redirect(`${base}/console/billing?card=fail`);

  const sess = await getSession();
  if (!sess) return NextResponse.redirect(`${base}/login`);

  const url = new URL(req.url);
  const authKey = url.searchParams.get("authKey");
  const customerKey = url.searchParams.get("customerKey");
  const encKey = process.env.ENCRYPTION_KEY;
  if (!authKey || !customerKey || !process.env.TOSS_SECRET_KEY || !encKey) return fail();

  // the customerKey must be one we would mint for this user
  let orgId: number | null = null;
  if (customerKey === `cai-${sess.uid}`) {
    orgId = null;
  } else {
    const m = customerKey.match(/^cai-org-(\d+)$/);
    if (!m) return fail();
    const member = await membershipOf(sess.uid);
    if (!member || member.orgId !== Number(m[1]) ||
        (member.role !== "owner" && member.role !== "admin")) return fail();
    orgId = member.orgId;
  }

  try {
    const res = await fetch("https://api.tosspayments.com/v1/billing/authorizations/issue", {
      method: "POST",
      headers: {
        authorization:
          "Basic " + Buffer.from(`${process.env.TOSS_SECRET_KEY}:`).toString("base64"),
        "content-type": "application/json",
      },
      body: JSON.stringify({ authKey, customerKey }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j?.billingKey) {
      console.error("toss billing issue failed:", res.status, JSON.stringify(j).slice(0, 200));
      return fail();
    }
    const last4 = String(j.card?.number ?? "").replace(/\D/g, "").slice(-4);
    const label = `${j.cardCompany ?? j.card?.cardCompany ?? "카드"}${last4 ? ` ····${last4}` : ""}`;

    if (orgId != null) {
      await db().query(
        `INSERT INTO org_payment_methods(org_id, psp, toss_billing_key_encrypted, toss_customer_key, card_label)
         VALUES($1,'toss',$2,$3,$4)
         ON CONFLICT (org_id) DO UPDATE SET
           psp='toss', toss_billing_key_encrypted=$2, toss_customer_key=$3, card_label=$4,
           stripe_customer_id=NULL, stripe_payment_method_id=NULL, created_at=now()`,
        [orgId, encrypt(j.billingKey, encKey), customerKey, label]
      );
      await audit(orgId, sess, "billing.card_set", label);
    } else {
      await db().query(
        `INSERT INTO payment_methods(user_id, psp, toss_billing_key_encrypted, toss_customer_key, card_label)
         VALUES($1,'toss',$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET
           psp='toss', toss_billing_key_encrypted=$2, toss_customer_key=$3, card_label=$4,
           stripe_customer_id=NULL, stripe_payment_method_id=NULL, created_at=now()`,
        [sess.uid, encrypt(j.billingKey, encKey), customerKey, label]
      );
    }
    return NextResponse.redirect(`${base}/console/billing?card=ok`);
  } catch (e) {
    console.error("toss confirm failed:", (e as Error).message);
    return fail();
  }
}
