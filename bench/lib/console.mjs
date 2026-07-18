// Minimal client for the caching.ai console API — used to mint/configure the
// benchmark's ck_ keys and to pull /api/stats for cross-verification.
// Credentials live outside the repo (~/.config/caching-bench/env).

import { loadBenchEnv } from "./util.mjs";

export const CONSOLE_URL = process.env.BENCH_CONSOLE_URL ?? "https://caching.ai";

let sessionCookie = null;

export async function login() {
  if (sessionCookie) return sessionCookie;
  const env = loadBenchEnv();
  if (!env.BENCH_EMAIL || !env.BENCH_PASSWORD) {
    throw new Error("BENCH_EMAIL/BENCH_PASSWORD missing — create ~/.config/caching-bench/env (see bench/README.md)");
  }
  const res = await fetch(`${CONSOLE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: env.BENCH_EMAIL, password: env.BENCH_PASSWORD }),
  });
  if (!res.ok) throw new Error(`console login failed: HTTP ${res.status}`);
  const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")].filter(Boolean);
  sessionCookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!sessionCookie) throw new Error("console login returned no session cookie");
  return sessionCookie;
}

async function api(method, path, body) {
  const cookie = await login();
  const res = await fetch(`${CONSOLE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`console ${method} ${path} → HTTP ${res.status}: ${json?.error ?? ""}`);
  return json;
}

export const listKeys = () => api("GET", "/api/keys");
export const createKey = (name) => api("POST", "/api/keys", { name });
export const patchKey = (id, patch) => api("PATCH", `/api/keys/${id}`, patch);
export const getStats = (days = 7) => api("GET", `/api/stats?days=${days}`);
