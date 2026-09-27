import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { base32Encode, hashPassword } from "../src/crypto.js";
import { openDb } from "../src/db.js";

const ORIGIN = "https://brief.example.com";
const SECRET = "s".repeat(40);
const passwordHash = await hashPassword("a very long password");
const vapid = webpush.generateVAPIDKeys();

function env(extra: Record<string, string> = {}) {
  return {
    PUBLIC_ORIGIN: ORIGIN, ICLOUD_EMAIL: "me@icloud.com", ICLOUD_APP_PASSWORD: "x", OPENAI_API_KEY: "x",
    APP_PASSWORD_HASH: passwordHash, TOTP_SECRET: base32Encode(randomBytes(20)),
    DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"), VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:a@b.c", ...extra,
  };
}

async function app(extra: Record<string, string> = {}) {
  return (await buildApp({ config: loadConfig(env(extra)), db: openDb(":memory:"), logger: false })).app;
}

/** Status codes of `n` failed logins, with per-attempt headers. */
async function attempts(a: Awaited<ReturnType<typeof app>>, n: number, headers: (i: number) => Record<string, string>) {
  const codes: number[] = [];
  for (let i = 0; i < n; i++) {
    const res = await a.inject({
      method: "POST", url: "/api/auth/login",
      headers: { origin: ORIGIN, ...headers(i) },
      payload: { password: "nope", totp: "000000" },
    });
    codes.push(res.statusCode);
  }
  return codes;
}

describe("client IP for rate limiting", () => {
  it("ignores a spoofed X-Forwarded-For (was a bypass)", async () => {
    const a = await app();
    const codes = await attempts(a, 6, (i) => ({ "x-real-ip": "198.51.100.7", "x-forwarded-for": `203.0.113.${i}` }));
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
    await a.close();
  });

  it("keys on Railway's X-Real-IP, so different clients have separate limits", async () => {
    const a = await app();
    await attempts(a, 6, () => ({ "x-real-ip": "198.51.100.7" }));
    const other = await attempts(a, 1, () => ({ "x-real-ip": "198.51.100.8" }));
    expect(other).toEqual([401]);
    await a.close();
  });

  it("ignores CF-Connecting-IP without the Cloudflare secret", async () => {
    const a = await app({ CLOUDFLARE_ORIGIN_SECRET: SECRET });
    const codes = await attempts(a, 6, (i) => ({ "x-real-ip": "198.51.100.7", "cf-connecting-ip": `203.0.113.${i}`, "x-origin-auth": "wrong" }));
    expect(codes[5]).toBe(429);
    await a.close();
  });

  it("trusts CF-Connecting-IP when the Cloudflare secret matches", async () => {
    const a = await app({ CLOUDFLARE_ORIGIN_SECRET: SECRET });
    // All traffic arrives from one Cloudflare edge IP, but real clients get separate limits.
    await attempts(a, 6, () => ({ "x-real-ip": "162.158.0.1", "cf-connecting-ip": "203.0.113.1", "x-origin-auth": SECRET }));
    const other = await attempts(a, 1, () => ({ "x-real-ip": "162.158.0.1", "cf-connecting-ip": "203.0.113.2", "x-origin-auth": SECRET }));
    expect(other).toEqual([401]);
    await a.close();
  });
});

describe("REQUIRE_CLOUDFLARE origin lock", () => {
  it("refuses direct requests but allows the health check and Cloudflare traffic", async () => {
    const a = await app({ CLOUDFLARE_ORIGIN_SECRET: SECRET, REQUIRE_CLOUDFLARE: "true" });
    expect((await a.inject({ method: "GET", url: "/" })).statusCode).toBe(403);
    expect((await a.inject({ method: "GET", url: "/api/auth/me" })).statusCode).toBe(403);
    expect((await a.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    const viaCf = await a.inject({ method: "GET", url: "/api/auth/me", headers: { "x-origin-auth": SECRET } });
    expect(viaCf.statusCode).toBe(401); // reached the app; just not signed in
    await a.close();
  });

  it("refuses to start without the secret", () => {
    expect(() => loadConfig(env({ REQUIRE_CLOUDFLARE: "true" }))).toThrow(/CLOUDFLARE_ORIGIN_SECRET/);
  });
});
