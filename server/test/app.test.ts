import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { base32Decode, base32Encode, currentTotpStep, hashPassword, totpAt } from "../src/crypto.js";
import { openDb } from "../src/db.js";

const ORIGIN = "https://mail.example.com";
const totpSecret = base32Encode(randomBytes(20));
let app: Awaited<ReturnType<typeof buildApp>>["app"];

beforeAll(async () => {
  const vapid = webpush.generateVAPIDKeys();
  const config = loadConfig({
    NODE_ENV: "production",
    PUBLIC_ORIGIN: ORIGIN,
    ICLOUD_EMAIL: "me@icloud.com",
    ICLOUD_APP_PASSWORD: "x",
    OPENAI_API_KEY: "x",
    APP_PASSWORD_HASH: await hashPassword("a very long password"),
    TOTP_SECRET: totpSecret,
    DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "mailto:me@example.com",
  });
  ({ app } = await buildApp({ config, db: openDb(":memory:"), logger: false }));
});
afterAll(() => app.close());

const code = (offset = 0) => totpAt(base32Decode(totpSecret), currentTotpStep() + offset);
const login = (body: object, origin = ORIGIN) =>
  app.inject({ method: "POST", url: "/api/auth/login", headers: { origin }, payload: body });

describe("auth", () => {
  it("blocks API access without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/messages" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects cross-origin POSTs", async () => {
    const res = await login({ password: "a very long password", totp: code() }, "https://evil.example");
    expect(res.statusCode).toBe(403);
  });

  it("rejects a wrong password", async () => {
    const res = await login({ password: "nope", totp: code() });
    expect(res.statusCode).toBe(401);
  });

  it("logs in, sets a hardened cookie, blocks TOTP replay", async () => {
    const totp = code(-1); // previous step, still in window
    const res = await login({ password: "a very long password", totp });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toMatch(/^__Host-imc_session=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Strict/);

    const cookie = setCookie.split(";")[0]!;
    const me = await app.inject({ method: "GET", url: "/api/messages", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.headers["cache-control"]).toBe("no-store");
    expect(me.headers["content-security-policy"]).toContain("img-src 'self' data:");

    const replay = await login({ password: "a very long password", totp });
    expect(replay.statusCode).toBe(401);

    const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie, origin: ORIGIN } });
    expect(out.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/messages", headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it("rate-limits login attempts", async () => {
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await login({ password: "nope", totp: "000000" })).statusCode;
    expect(last).toBe(429);
  });
});
