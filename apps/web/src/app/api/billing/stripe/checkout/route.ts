import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/org";

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

/** create a Checkout session in setup mode — card entry happens on Stripe.
 *  In the org workspace (admins) the saved card becomes the TEAM card. */
export async function POST() {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (ws.org && ws.org.role !== "owner" && ws.org.role !== "admin") {
    return NextResponse.json({ error: "Workspace admins only." }, { status: 403 });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Card registration isn't available right now." }, { status: 503 });
  }
  const base = process.env.PUBLIC_BASE_URL ?? "https://caching.ai";

  try {
    // reuse the existing Stripe customer for this workspace if there is one
    const { rows } = ws.org
      ? await db().query(
          "SELECT stripe_customer_id FROM org_payment_methods WHERE org_id=$1 AND stripe_customer_id IS NOT NULL",
          [ws.org.orgId]
        )
      : await db().query(
          "SELECT stripe_customer_id FROM payment_methods WHERE user_id=$1 AND stripe_customer_id IS NOT NULL",
          [ws.session.uid]
        );
    let customer = rows[0]?.stripe_customer_id as string | undefined;
    if (!customer) {
      const c = await stripePost("/v1/customers", {
        email: ws.session.email,
        ...(ws.org
          ? { "metadata[cai_org_id]": String(ws.org.orgId), name: ws.org.orgName }
          : { "metadata[cai_user_id]": String(ws.session.uid) }),
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
