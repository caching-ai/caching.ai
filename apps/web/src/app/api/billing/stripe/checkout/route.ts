import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

const STRIPE = "https://api.stripe.com";

async function stripePost(path: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${STRIPE}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message ?? `stripe ${res.status}`);
  return j;
}

/** create a Checkout session in setup mode — card entry happens on Stripe */
export async function POST() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Card registration isn't available right now." }, { status: 503 });
  }
  const base = process.env.PUBLIC_BASE_URL ?? "https://caching.ai";

  try {
    // reuse the Stripe customer if this user already has one
    const { rows } = await db().query(
      "SELECT stripe_customer_id FROM payment_methods WHERE user_id=$1 AND stripe_customer_id IS NOT NULL",
      [sess.uid]
    );
    let customer = rows[0]?.stripe_customer_id as string | undefined;
    if (!customer) {
      const c = await stripePost("/v1/customers", {
        email: sess.email,
        "metadata[cai_user_id]": String(sess.uid),
      });
      customer = c.id;
    }

    const s = await stripePost("/v1/checkout/sessions", {
      mode: "setup",
      customer: customer!,
      "payment_method_types[0]": "card",
      success_url: `${base}/api/billing/stripe/confirm?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/console/billing?card=cancel`,
    });
    return NextResponse.json({ url: s.url });
  } catch (e) {
    console.error("stripe checkout create failed:", (e as Error).message);
    return NextResponse.json({ error: "Couldn't start card registration. Please try again." }, { status: 502 });
  }
}
