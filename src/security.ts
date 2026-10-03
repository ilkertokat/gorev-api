import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// ---------------------------------------------------------------------------
// Parola özeti: scrypt + rastgele tuz. Biçim: scrypt$<tuz-hex>$<özet-hex>
// ---------------------------------------------------------------------------
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected); // zamanlama saldırısına karşı sabit süreli karşılaştırma
}

// ---------------------------------------------------------------------------
// JWT (HS256). Yalnızca HS256 kabul edilir: "alg: none" ve algoritma karıştırma saldırıları reddedilir.
// ---------------------------------------------------------------------------
const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export interface TokenPayload {
  sub: number;
  email: string;
  iat: number;
  exp: number;
}

export function signToken(sub: number, email: string, secret: string, ttlSeconds = 60 * 60 * 24): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ sub, email, iat: now, exp: now + ttlSeconds } satisfies TokenPayload));
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  try {
    if (JSON.parse(Buffer.from(header, "base64url").toString()).alg !== "HS256") return null;
    const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as TokenPayload;
    if (typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Basit kayan pencere hız sınırlayıcı (bellek içi) — kaba kuvvet giriş denemelerine karşı.
// ---------------------------------------------------------------------------
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** İzin varsa true döner ve denemeyi kaydeder. */
  take(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
