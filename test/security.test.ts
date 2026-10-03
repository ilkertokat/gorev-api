import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RateLimiter, hashPassword, signToken, verifyPassword, verifyToken } from "../src/security.ts";

const SECRET = "x".repeat(40);

describe("passwords", () => {
  it("hashes with a random salt and verifies", async () => {
    const a = await hashPassword("parola123"), b = await hashPassword("parola123");
    assert.notEqual(a, b);
    assert.match(a, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.equal(await verifyPassword("parola123", a), true);
    assert.equal(await verifyPassword("yanlis", a), false);
    assert.equal(await verifyPassword("parola123", "bozuk"), false);
  });
});

describe("JWT", () => {
  it("round-trips a valid token", () => {
    const t = signToken(7, "a@b.c", SECRET);
    const p = verifyToken(t, SECRET);
    assert.equal(p?.sub, 7);
    assert.equal(p?.email, "a@b.c");
  });

  it("rejects a wrong secret, tampering, expiry and alg:none", () => {
    const t = signToken(7, "a@b.c", SECRET);
    assert.equal(verifyToken(t, "y".repeat(40)), null);

    const [h, p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: 1 })).toString("base64url");
    assert.equal(verifyToken(`${h}.${forged}.${s}`, SECRET), null);

    assert.equal(verifyToken(signToken(7, "a@b.c", SECRET, -10), SECRET), null);

    const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    assert.equal(verifyToken(`${none}.${p}.`, SECRET), null);
    assert.equal(verifyToken("çöp", SECRET), null);
  });
});

describe("RateLimiter", () => {
  it("allows N hits per window, then blocks until the window slides", () => {
    const rl = new RateLimiter(3, 1000);
    assert.deepEqual([rl.take("k", 0), rl.take("k", 10), rl.take("k", 20), rl.take("k", 30)], [true, true, true, false]);
    assert.equal(rl.take("baska", 30), true);
    assert.equal(rl.take("k", 1001), true);
    rl.reset("k");
    assert.equal(rl.take("k", 1002), true);
  });
});
