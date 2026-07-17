import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

const STRIPE = "https://api.stripe.com";

async function stripeGet(path: string): Promise<any> {
  const res = await fetch(`${STRIPE}${path}`, {
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message ?? `stripe ${res.status}`);
  return j;
}

/** Checkout success redirect: read the saved card off the session and store it */
export async function GET(req: Request) {
  const base = process.env.PUBLIC_BASE_URL ?? "https://caching.ai";
  const fail = () => NextResponse.redirect(`${base}/console/billing?card=fail`);

  const sess = await getSession();
  if (!sess) return NextResponse.redirect(`${base}/login`);
  const sessionId = new URL(req.url).searchParams.get("session_id");
  if (!sessionId || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) return fail();

  try {
    const s = await stripeGet(`/v1/checkout/sessions/${sessionId}?expand[]=setup_intent`);
    const customer: string | undefined = typeof s.customer === "string" ? s.customer : s.customer?.id;
    const pmId: string | undefined = s.setup_intent?.payment_method;
    if (s.status !== "complete" || !customer || !pmId) return fail();

    const pm = await stripeGet(`/v1/payment_methods/${pmId}`);
    const label = pm?.card ? `${pm.card.brand} ····${pm.card.last4}` : "card";

    await db().query(
      `INSERT INTO payment_methods(user_id, psp, stripe_customer_id, stripe_payment_method_id, card_label)
       VALUES($1,'stripe',$2,$3,$4)
       ON CONFLICT (user_id) DO UPDATE SET
         psp='stripe', stripe_customer_id=$2, stripe_payment_method_id=$3, card_label=$4,
         toss_billing_key_encrypted=NULL, toss_customer_key=NULL, created_at=now()`,
      [sess.uid, customer, pmId, label]
    );
    return NextResponse.redirect(`${base}/console/billing?card=ok`);
  } catch (e) {
    console.error("stripe confirm failed:", (e as Error).message);
    return fail();
  }
}
