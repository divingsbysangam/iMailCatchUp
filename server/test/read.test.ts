import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { randomToken, sha256 } from "../src/crypto.js";
import { openDb } from "../src/db.js";

const ORIGIN = "https://brief.example.com";
const vapid = webpush.generateVAPIDKeys();
const apps: { close: () => Promise<unknown> }[] = [];
afterAll(() => Promise.all(apps.map((a) => a.close())));

async function setup(markRead: boolean) {
  const config = loadConfig({
    PUBLIC_ORIGIN: ORIGIN, ICLOUD_EMAIL: "me@icloud.com", ICLOUD_APP_PASSWORD: "x", OPENAI_API_KEY: "x",
    APP_PASSWORD_HASH: "scrypt:x", TOTP_SECRET: "A".repeat(32), DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:a@b.c",
    NODE_ENV: "test", MARK_READ_ON_OPEN: markRead ? "true" : "false",
    // iCloud is unreachable in tests: the background flush fails fast and the queue is kept.
    IMAP_HOST: "127.0.0.1", IMAP_PORT: "1",
  });
  const db = openDb(":memory:");
  const { app } = await buildApp({ config, db, logger: false });
  apps.push(app);
  const token = randomToken();
  db.prepare("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)").run(sha256(token), Date.now(), Date.now() + 3600e3);
  const ins = db.prepare(
    "INSERT INTO messages (mailbox, uid_validity, uid, date, synced_at, archived, todo) VALUES ('INBOX', '7', ?, ?, ?, ?, ?)",
  );
  const plain = Number(ins.run(11, Date.now(), Date.now(), 0, 0).lastInsertRowid);
  const todo = Number(ins.run(12, Date.now(), Date.now(), 0, 1).lastInsertRowid);
  const archived = Number(ins.run(13, Date.now(), Date.now(), 1, 0).lastInsertRowid);
  const read = (id: number) =>
    app.inject({ method: "POST", url: `/api/messages/${id}/read`, headers: { origin: ORIGIN, cookie: `imc_session=${token}` } });
  return { db, read, plain, todo, archived };
}

describe("mark read on close", () => {
  it("queues the iCloud update and removes the app's copy", async () => {
    const { db, read, plain } = await setup(true);
    const res = await read(plain);
    expect(res.json()).toEqual({ ok: true, markedRead: true, removed: true });
    expect(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE id = ?").get(plain)).toEqual({ n: 0 });
    expect(db.prepare("SELECT mailbox, uid_validity, uid FROM pending_seen").all()).toEqual([{ mailbox: "INBOX", uid_validity: "7", uid: 11 }]);
  });

  it("keeps open to-dos, and doesn't re-flag mail already archived", async () => {
    const { db, read, todo, archived } = await setup(true);
    expect((await read(todo)).json()).toMatchObject({ removed: false });
    expect(db.prepare("SELECT seen FROM messages WHERE id = ?").get(todo)).toEqual({ seen: 1 });
    expect((await read(archived)).json()).toMatchObject({ removed: true });
    expect(db.prepare("SELECT uid FROM pending_seen ORDER BY uid").all()).toEqual([{ uid: 12 }]);
  });

  it("does nothing when MARK_READ_ON_OPEN is off", async () => {
    const { db, read, plain } = await setup(false);
    expect((await read(plain)).json()).toEqual({ ok: true, markedRead: false, removed: false });
    expect(db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 3 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM pending_seen").get()).toEqual({ n: 0 });
  });
});
