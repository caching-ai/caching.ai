import { timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deriveTokenSecret, getPool, migrate } from "@caching/shared";
import { loadConfig, PROXY_VERSION } from "./config.js";
import { buildApp } from "./app.js";
import { startKeepaliveLoop } from "./keepalive.js";
import { startAdaptiveLoop } from "@caching/ee-adaptive";
import { startBillingLoop } from "./billing.js";
import { startChargeLoop } from "./charge.js";
import {
  startWeeklyReportLoop,
  weeklyStatsFor,
  renderWeeklyReportHtml,
  sendViaResend,
} from "./emailReport.js";
import { startBudgetAlertLoop } from "./budgetAlert.js";
import { startRollupLoop } from "./rollup.js";
import { startFxLoop } from "./fx.js";

const cfg = loadConfig();
const pool = getPool(cfg.databaseUrl);

// migrations ship inside the image next to the bundle (see Dockerfile)
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = process.env.MIGRATIONS_DIR ?? join(here, "migrations");

const applied = await migrate(migrationsDir, cfg.databaseUrl);
if (applied.length) console.log("migrations applied:", applied.join(", "));

const app = buildApp({
  pool,
  upstreamUrl: cfg.upstreamUrl,
  openaiUpstreamUrl: process.env.OPENAI_UPSTREAM_URL,
  geminiUpstreamUrl: process.env.GEMINI_UPSTREAM_URL,
  grokUpstreamUrl: process.env.GROK_UPSTREAM_URL,
  encryptionKey: cfg.encryptionKey,
});

const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`caching-proxy v${PROXY_VERSION} listening on :${info.port} -> ${cfg.upstreamUrl}`);
});

// graceful shutdown: stop accepting, let in-flight streams and fire-and-forget
// log writes drain, then release the pool
let shuttingDown = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${sig} received — draining (max 30s)`);
    server.close(async () => {
      try { await pool.end(); } catch { /* already closed */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 30_000).unref();
  });
}

startKeepaliveLoop({
  pool,
  upstreamUrl: cfg.upstreamUrl,
  encryptionKey: cfg.encryptionKey,
});
startBillingLoop(pool);
startRollupLoop(pool);
startFxLoop(pool);
// cloud-only (ee/adaptive-cache, commercial license): adaptive cache tuning
if (process.env.CACHING_CLOUD === "1") {
  startAdaptiveLoop(pool);
  console.log("adaptive cache tuning armed (CACHING_CLOUD)");
}
if (process.env.BILLING_LIVE === "1") {
  startChargeLoop({
    pool,
    encryptionKey: cfg.encryptionKey,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    tossSecretKey: process.env.TOSS_SECRET_KEY,
    fxKrwPerUsd: Number(process.env.FX_KRW_PER_USD ?? 1400),
    minChargeUsd: Number(process.env.MIN_CHARGE_USD ?? 5),
  });
  console.log("postpaid charge loop armed (BILLING_LIVE)");
}

if (process.env.RESEND_API_KEY) {
  const resendApiKey = process.env.RESEND_API_KEY;
  startWeeklyReportLoop({ pool, resendApiKey, unsubscribeSecret: deriveTokenSecret(cfg.encryptionKey) });
  startBudgetAlertLoop({ pool, resendApiKey, unsubscribeSecret: deriveTokenSecret(cfg.encryptionKey) });
  console.log("weekly report + budget alert loops armed");

  // ops-only: render the current weekly report and send it to an override
  // address (test mode — bypasses the once-per-week dedup on purpose).
  if (process.env.ADMIN_TOKEN && process.env.OPS_REPORT_EMAIL) {
    const adminToken = process.env.ADMIN_TOKEN;
    // recipient is pinned server-side: even with a leaked token this endpoint
    // can only mail the configured ops address, never an attacker's
    const to = process.env.OPS_REPORT_EMAIL;
    app.post("/admin/test-report", async (c) => {
      const given = Buffer.from(c.req.header("x-admin-token") ?? "");
      const want = Buffer.from(adminToken);
      if (given.length !== want.length || !timingSafeEqual(given, want)) {
        return c.json({ error: "forbidden" }, 403);
      }
      const stats = await weeklyStatsFor(pool);
      let sent = 0;
      for (const s of stats) {
        const { subject, html } = renderWeeklyReportHtml(s);
        if (await sendViaResend({ pool, resendApiKey }, to, `[test] ${subject}`, html)) sent++;
      }
      return c.json({ sent, users: stats.length });
    });
  }
} else {
  console.log("RESEND_API_KEY not set — weekly reports disabled");
}
