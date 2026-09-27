import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { FieldCipher, randomToken, sha256 } from "../src/crypto.js";
import { openDb } from "../src/db.js";

const pushes: { title: string; body: string; url: string }[] = [];
vi.mock("../src/push.js", async (orig) => ({
  ...(await orig<typeof import("../src/push.js")>()),
  sendPushToAll: async (_ctx: unknown, p: { title: string; body: string; url: string }) => {
    pushes.push(p);
    return { sent: 1, removed: 0 };
  },
}));
const { notifyNeedsYou } = await import("../src/notify.js");

const ORIGIN = "https://brief.example.com";
const vapid = webpush.generateVAPIDKeys();
const apps: { close: () => Promise<unknown> }[] = [];
afterAll(() => Promise.all(apps.map((a) => a.close())));

function config(extra: Record<string, string> = {}) {
  return loadConfig({
    PUBLIC_ORIGIN: ORIGIN, ICLOUD_EMAIL: "me@icloud.com", ICLOUD_APP_PASSWORD: "x", OPENAI_API_KEY: "x",
    APP_PASSWORD_HASH: "scrypt:x", TOTP_SECRET: "A".repeat(32), DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:a@b.c",
    NODE_ENV: "test", IMAP_HOST: "127.0.0.1", IMAP_PORT: "1", ...extra,
  });
}

function setup(extra: Record<string, string> = {}) {
  const cfg = config(extra);
  const db = openDb(":memory:");
  const cipher = new FieldCipher(cfg.DATA_ENCRYPTION_KEY);
  const ctx = { config: cfg, db, cipher, log: { info() {}, warn() {}, error() {} } } as never;
  const add = (subject: string, ageMs: number, action = "inbox") =>
    Number(
      db
        .prepare("INSERT INTO messages (mailbox, uid_validity, uid, from_name, subject_enc, date, synced_at, action, triaged_at) VALUES ('INBOX','1',?,?,?,?,?,?,?)")
        .run(Math.floor(Math.random() * 1e9), "Priya", cipher.encrypt(subject), Date.now() - ageMs, Date.now(), action, Date.now()).lastInsertRowid,
    );
  return { ctx, db, add };
}

describe("needs-you notifications", () => {
  it("notifies once for fresh needs-you mail, with a preview", async () => {
    pushes.length = 0;
    const { ctx, add } = setup();
    const id = add("Can we move Thursday's call?", 60_000);
    add("Weekly digest", 60_000, "brief");
    expect(await notifyNeedsYou(ctx)).toEqual({ notified: 1 });
    expect(pushes).toEqual([{ title: "Needs you · Priya", body: "Can we move Thursday's call?", url: `/#/messages/${id}`, tag: "needs-you" }]);
    expect(await notifyNeedsYou(ctx)).toEqual({ notified: 0 }); // never twice
  });

  it("groups several, skips old backlog, and hides content when preview is off", async () => {
    pushes.length = 0;
    const { ctx, add } = setup({ BRIEF_PUSH_PREVIEW: "false" });
    add("Old question?", 3 * 24 * 3600e3);
    add("A?", 60_000);
    add("B?", 120_000);
    expect(await notifyNeedsYou(ctx)).toEqual({ notified: 2 });
    expect(pushes[0]).toMatchObject({ title: "2 emails need you", body: "Open Surface to see them.", url: "/#/needs" });
  });

  it("stays quiet when NEEDS_YOU_PUSH is off", async () => {
    pushes.length = 0;
    const off = setup({ NEEDS_YOU_PUSH: "false" });
    off.add("Q?", 60_000);
    expect(await notifyNeedsYou(off.ctx)).toEqual({ notified: 0 });
    expect(pushes).toHaveLength(0);
  });
});

describe("live iCloud routes", () => {
  it("validate input and report iCloud being unreachable", async () => {
    const db = openDb(":memory:");
    const { app } = await buildApp({ config: config(), db, logger: false });
    apps.push(app);
    const token = randomToken();
    db.prepare("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)").run(sha256(token), Date.now(), Date.now() + 3600e3);
    const get = (url: string, auth = true) => app.inject({ url, headers: auth ? { cookie: `imc_session=${token}` } : {} });

    expect((await get("/api/mail/folders", false)).statusCode).toBe(401);
    expect((await get("/api/mail/search?q=a")).statusCode).toBe(400); // too short
    expect((await get("/api/mail/message?folder=INBOX&uid=abc")).statusCode).toBe(400);
    expect((await get(`/api/mail/list?folder=${encodeURIComponent("bad\u0000name")}`)).statusCode).toBe(400);
    const r = await get("/api/mail/folders");
    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ error: "Couldn't reach iCloud. Try again." });
  });
});
