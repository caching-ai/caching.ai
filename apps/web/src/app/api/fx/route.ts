import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// FX snapshot for money display (units per 1 USD). The proxy refreshes
// fx_rates daily; these statics only cover a fresh install's first sweep.
const FALLBACK: Record<string, number> = { KRW: 1520, JPY: 162, CNY: 6.8, EUR: 0.87 };

export async function GET() {
  const rates = { ...FALLBACK };
  let updatedAt: string | null = null;
  try {
    const { rows } = await db().query(
      "SELECT code, per_usd::float AS rate, updated_at FROM fx_rates"
    );
    for (const r of rows) {
      if (r.rate > 0) rates[r.code] = r.rate;
      if (!updatedAt || r.updated_at > updatedAt) updatedAt = r.updated_at;
    }
  } catch {
    // fall through to statics — display-only data
  }
  return NextResponse.json(
    { rates, updatedAt },
    { headers: { "cache-control": "public, max-age=3600" } }
  );
}
