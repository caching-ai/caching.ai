import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Generate a Caching.ai API key: ck_<40 hex chars> */
export function generateApiKey(): string {
  return "ck_" + randomBytes(20).toString("hex");
}

// ---- AES-256-GCM (key = 32-byte hex from env ENCRYPTION_KEY) ----

function keyBuf(hexKey: string): Buffer {
  const b = Buffer.from(hexKey, "hex");
  if (b.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes of hex (64 hex chars)");
  return b;
}

/** returns base64(iv || ciphertext || authTag) */
export function encrypt(plaintext: string, hexKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBuf(hexKey), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString("base64");
}

export function decrypt(payload: string, hexKey: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", keyBuf(hexKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ---- signed session cookie (HMAC-SHA256) ----

export function signSession(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession<T = any>(token: string, secret: string): T | null {
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (parsed.exp && Date.now() > parsed.exp) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/**
 * Dedicated signing secret for email tokens (verification / unsubscribe),
 * derived from ENCRYPTION_KEY so no new env var is needed — but the AES key
 * itself is never reused as an HMAC secret.
 */
export function deriveTokenSecret(encryptionKey: string): string {
  return createHmac("sha256", encryptionKey).update("caching-token-signing-v1").digest("hex");
}
