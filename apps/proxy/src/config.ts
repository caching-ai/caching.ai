// Single version authority: /healthz, the boot banner and the
// caching_build_info metric all read this. Bump together with package.json.
export const PROXY_VERSION = "0.11.1";

export interface ProxyConfig {
  upstreamUrl: string;
  encryptionKey: string;
  databaseUrl?: string;
  port: number;
}

export function loadConfig(): ProxyConfig {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("ENCRYPTION_KEY is required");
  return {
    upstreamUrl: process.env.UPSTREAM_URL ?? "https://api.anthropic.com",
    encryptionKey,
    databaseUrl: process.env.DATABASE_URL,
    port: Number(process.env.PORT ?? 8080),
  };
}
