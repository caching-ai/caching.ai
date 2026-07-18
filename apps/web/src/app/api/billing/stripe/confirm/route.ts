import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, getWorkspace } from "@/lib/org";

const STRIPE = "https://api.stripe.com";

async function stripeGet(path: string): Promise<any> {
  const res = await fetch(`${STRIPE}${path}`, {
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message ?? `stripe ${res.status}`);
  return j;
}

/** Checkout success redirect: read the saved card off the session and store
 *  it. The Stripe customer's metadata says which workspace it belongs to —
 *  never trust the browser's cookie alone for the org path. */
export async function GET(req: Request) {
  const base = process.env.PUBLIC_BASE_URL ?? "https://caching.ai";
  const fail = () => NextResponse.redirect(`${base}/console/billing?card=fail`);

  const ws = await getWorkspace();
  if (!ws) return NextResponse.redirect(`${base}/login`);
  const sessionId = new URL(req.url).searchParams.get("session_id");
  if (!sessionId || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) return fail();

  try {
    const s = await stripeGet(`/v1/checkout/sessions/${sessionId}?expand[]=setup_intent&expand[]=customer`);
    const customerObj = typeof s.customer === "string" ? null : s.customer;
    const customer: string | undefined = typeof s.customer === "string" ? s.customer : s.customer?.id;
    const pmId: string | undefined = s.setup_intent?.payment_method;
    if (s.status !== "complete" || !customer || !pmId) return fail();

    const pm = await stripeGet(`/v1/payment_methods/${pmId}`);
    const label = pm?.card ? `${pm.card.brand} ····${pm.card.last4}` : "card";

    const metaOrg = Number(customerObj?.metadata?.cai_org_id ?? NaN);
    if (Number.isInteger(metaOrg)) {
      // org card: current user must be an admin of exactly that org
      if (!ws.memberOf || ws.memberOf.orgId !== metaOrg ||
          (ws.memberOf.role !== "owner" && ws.memberOf.role !== "admin")) return fail();
      await db().query(
        `INSERT INTO org_payment_methods(org_id, psp, stripe_customer_id, stripe_payment_method_id, card_label)
         VALUES($1,'stripe',$2,$3,$4)
         ON CONFLICT (org_id) DO UPDATE SET
           psp='stripe', stripe_customer_id=$2, stripe_payment_method_id=$3, card_label=$4,
           toss_billing_key_encrypted=NULL, toss_customer_key=NULL, created_at=now()`,
        [metaOrg, customer, pmId, label]
      );
      await audit(metaOrg, ws.session, "billing.card_set", label);
    } else {
      await db().query(
        `INSERT INTO payment_methods(user_id, psp, stripe_customer_id, stripe_payment_method_id, card_label)
         VALUES($1,'stripe',$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET
           psp='stripe', stripe_customer_id=$2, stripe_payment_method_id=$3, card_label=$4,
           toss_billing_key_encrypted=NULL, toss_customer_key=NULL, created_at=now()`,
        [ws.session.uid, customer, pmId, label]
      );
    }
    return NextResponse.redirect(`${base}/console/billing?card=ok`);
  } catch (e) {
    console.error("stripe confirm failed:", (e as Error).message);
    return fail();
  }
}
