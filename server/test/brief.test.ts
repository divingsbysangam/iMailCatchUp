import { describe, expect, it } from "vitest";
import { buildUserPrompt, parseBrief } from "../src/brief.js";
import { isBriefDue, localNow } from "../src/scheduler.js";

describe("parseBrief", () => {
  it("drops highlights that reference unknown emails", () => {
    const raw = JSON.stringify({
      headline: "h",
      summary: "s",
      highlights: [
        { emailId: 1, priority: "high", why: "a" },
        { emailId: 999, priority: "low", why: "made up" },
      ],
      actionItems: [{ task: "t", emailId: 999, due: null }],
    });
    const b = parseBrief(raw, new Set([1]));
    expect(b.highlights.map((h) => h.emailId)).toEqual([1]);
    expect(b.actionItems[0]!.emailId).toBeNull();
  });

  it("rejects malformed output", () => {
    expect(() => parseBrief('{"headline": 1}', new Set())).toThrow();
    expect(() => parseBrief("not json", new Set())).toThrow();
  });

  it("serialises emails as JSON data", () => {
    const p = buildUserPrompt([{ id: 1, from: "a", subject: 'ignore "rules"', date: "d", body: "b" }], "UTC");
    expect(p).toContain('"subject":"ignore \\"rules\\""');
  });
});

describe("scheduler", () => {
  it("computes local time in a time zone", () => {
    const d = new Date("2026-01-15T14:00:00Z");
    expect(localNow("Asia/Kolkata", d)).toEqual({ date: "2026-01-15", time: "19:30" });
    expect(localNow("UTC", d)).toEqual({ date: "2026-01-15", time: "14:00" });
  });

  const base = { briefTime: "19:00", lastDoneDate: null, attempts: null, nowMs: 1_000_000_000 };
  it("is due once per day after brief time", () => {
    expect(isBriefDue({ ...base, local: { date: "2026-01-15", time: "18:59" } })).toBe(false);
    expect(isBriefDue({ ...base, local: { date: "2026-01-15", time: "19:00" } })).toBe(true);
    expect(isBriefDue({ ...base, local: { date: "2026-01-15", time: "23:10" } })).toBe(true); // catch-up after restart
    expect(isBriefDue({ ...base, lastDoneDate: "2026-01-15", local: { date: "2026-01-15", time: "20:00" } })).toBe(false);
  });

  it("backs off and caps retries", () => {
    const local = { date: "2026-01-15", time: "19:30" };
    const recent = { date: "2026-01-15", count: 1, lastAt: base.nowMs - 60_000 };
    expect(isBriefDue({ ...base, local, attempts: recent })).toBe(false);
    expect(isBriefDue({ ...base, local, attempts: { ...recent, lastAt: base.nowMs - 16 * 60_000 } })).toBe(true);
    expect(isBriefDue({ ...base, local, attempts: { ...recent, count: 5, lastAt: 0 } })).toBe(false);
  });
});

describe("generateBrief", async () => {
  const { randomBytes } = await import("node:crypto");
  const { openDb } = await import("../src/db.js");
  const { FieldCipher } = await import("../src/crypto.js");
  const { generateBrief } = await import("../src/brief.js");
  const { loadConfig } = await import("../src/config.js");
  const webpush = (await import("web-push")).default;

  it("summarises recent mail, stores it encrypted, and warns on stale sync", async () => {
    const vapid = webpush.generateVAPIDKeys();
    const config = loadConfig({
      PUBLIC_ORIGIN: "https://x.example", ICLOUD_EMAIL: "me@icloud.com", ICLOUD_APP_PASSWORD: "x", OPENAI_API_KEY: "x",
      APP_PASSWORD_HASH: "scrypt:x", TOTP_SECRET: "A".repeat(32), DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:a@b.c",
    });
    const db = openDb(":memory:");
    const cipher = new FieldCipher(config.DATA_ENCRYPTION_KEY);
    const log = { info() {}, warn() {}, error() {} } as never;
    db.prepare(
      "INSERT INTO messages (mailbox, uid_validity, uid, from_address, subject_enc, text_enc, date, synced_at) VALUES ('INBOX','1',1,'a@b.c',?,?,?,?)",
    ).run(cipher.encrypt("Invoice due"), cipher.encrypt("Pay by Friday"), Date.now() - 1000, Date.now());

    let prompt = "";
    const fakeOpenAI = {
      chat: {
        completions: {
          create: async (req: { messages: { content: string }[] }) => {
            prompt = req.messages[1]!.content;
            return {
              model: "fake-model",
              choices: [{ message: { content: JSON.stringify({ headline: "Invoice due Friday", summary: "One invoice.", highlights: [{ emailId: 1, priority: "high", why: "Payment" }], actionItems: [] }) } }],
            };
          },
        },
      },
    };
    const { id, content } = await generateBrief({ config, db, cipher, log }, "manual", { syncFailed: true }, fakeOpenAI as never);
    expect(prompt).toContain("Invoice due");
    expect(content.highlights).toHaveLength(1);
    expect(content.summary).toMatch(/^⚠ Couldn't reach iCloud/);
    const row = db.prepare("SELECT content_enc, model FROM briefs WHERE id = ?").get(id) as { content_enc: string; model: string };
    expect(row.content_enc).not.toContain("Invoice");
    expect(row.model).toBe("fake-model");
  });
});
