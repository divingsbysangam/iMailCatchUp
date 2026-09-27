import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { generateBrief, groupSections, parseOverview } from "../src/brief.js";
import { loadConfig } from "../src/config.js";
import { FieldCipher } from "../src/crypto.js";
import { openDb } from "../src/db.js";
import { normalizeBrief } from "../src/routes.js";
import { dueSlot, localNow } from "../src/scheduler.js";
import { parseTriage, triageMessages } from "../src/triage.js";

const vapid = webpush.generateVAPIDKeys();
function makeCtx(extra: Record<string, string> = {}) {
  const config = loadConfig({
    PUBLIC_ORIGIN: "https://x.example", ICLOUD_EMAIL: "me@icloud.com", ICLOUD_APP_PASSWORD: "x", OPENAI_API_KEY: "x",
    APP_PASSWORD_HASH: "scrypt:x", TOTP_SECRET: "A".repeat(32), DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:a@b.c", ...extra,
  });
  const db = openDb(":memory:");
  const cipher = new FieldCipher(config.DATA_ENCRYPTION_KEY);
  const log = { info() {}, warn() {}, error() {} } as never;
  return { config, db, cipher, log };
}

function fakeOpenAI(reply: (prompt: string) => object) {
  const prompts: string[] = [];
  return {
    prompts,
    client: {
      chat: {
        completions: {
          create: async (req: { messages: { content: string }[] }) => {
            const prompt = req.messages[1]!.content;
            prompts.push(prompt);
            return { model: "fake-model", usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [{ message: { content: JSON.stringify(reply(prompt)) } }] };
          },
        },
      },
    } as never,
  };
}

describe("config", () => {
  it("uses BRIEF_TIMES, sorted and de-duplicated, else falls back to BRIEF_TIME", () => {
    expect(makeCtx({ BRIEF_TIMES: "18:00, 08:30,18:00" }).config.briefTimes).toEqual(["08:30", "18:00"]);
    expect(makeCtx({ BRIEF_TIME: "19:00" }).config.briefTimes).toEqual(["19:00"]);
    expect(() => makeCtx({ BRIEF_TIMES: "8:30" })).toThrow();
  });
});

describe("parseTriage", () => {
  it("keeps valid entries once, forces needs_reply to inbox, falls back on unknown category", () => {
    const raw = JSON.stringify({
      emails: [
        { emailId: 1, category: "needs_reply", action: "brief", summary: "a", highlight: null },
        { emailId: 1, category: "fyi", action: "brief", summary: "dup" },
        { emailId: 2, category: "made_up", action: "brief", summary: "b", highlight: "₹799" },
        { emailId: 99, category: "fyi", action: "brief", summary: "not in batch" },
      ],
    });
    const out = parseTriage(raw, new Set([1, 2]));
    expect(out.map((e) => [e.emailId, e.category, e.action])).toEqual([
      [1, "needs_reply", "inbox"],
      [2, "fyi", "brief"],
    ]);
  });
});

describe("triage + brief", () => {
  it("screens mail, then briefs only brief-bound items grouped by category", async () => {
    const ctx = makeCtx();
    const ins = ctx.db.prepare(
      "INSERT INTO messages (mailbox, uid_validity, uid, from_name, from_address, subject_enc, text_enc, date, is_bulk, synced_at) VALUES ('INBOX','1',?,?,?,?,?,?,?,?)",
    );
    ins.run(1, "Rahul", "rahul@x.com", ctx.cipher.encrypt("Contract"), ctx.cipher.encrypt("Can you sign by Monday?\n\nOn Sun, A wrote:\n> old"), Date.now() - 3000, 0, Date.now());
    ins.run(2, "Airtel", "bills@airtel.in", ctx.cipher.encrypt("Your bill"), ctx.cipher.encrypt("Bill of ₹799 due 3 Oct https://pay.example/x"), Date.now() - 2000, 0, Date.now());
    ins.run(3, "Digest", "news@digest.com", ctx.cipher.encrypt("Weekly"), ctx.cipher.encrypt("View in browser\nBig news today.\nUnsubscribe"), Date.now() - 1000, 1, Date.now());

    const triage = fakeOpenAI(() => ({
      emails: [
        { emailId: 1, category: "needs_reply", action: "inbox", summary: "Rahul needs the signed contract by Monday.", highlight: "Mon" },
        { emailId: 2, category: "payments", action: "brief", summary: "Airtel bill due 3 Oct.", highlight: "₹799" },
        { emailId: 3, category: "newsletters", action: "brief", summary: "Big news today.", highlight: null },
      ],
    }));
    expect((await triageMessages(ctx, triage.client)).triaged).toBe(3);
    expect(triage.prompts[0]).toContain("Bill of ₹799 due 3 Oct [link]"); // body sent, URL removed …
    expect(triage.prompts[0]).not.toContain("> old"); // … quoted reply removed
    expect(triage.prompts[0]).not.toContain("Unsubscribe"); // … newsletter footer removed

    const brief = fakeOpenAI(() => ({ headline: "Airtel bill due; one newsletter.", overview: "Quiet day.", important: [{ emailId: 2, why: "Due soon" }, { emailId: 42, why: "x" }] }));
    const { id, content } = await generateBrief(ctx, { trigger: "manual", localDate: "2026-09-27", slot: "18:00" }, brief.client);
    expect(content.sections.map((s) => s.category)).toEqual(["payments", "newsletters"]);
    expect(content.sections[0]!.items[0]).toMatchObject({ emailId: 2, highlight: "₹799", from: "Airtel" });
    expect(content.important).toEqual([{ emailId: 2, why: "Due soon" }]);
    expect(content.needsYou).toBe(1);
    expect(brief.prompts[0]).not.toContain("Rahul"); // inbox mail isn't in the brief

    const row = ctx.db.prepare("SELECT slot, local_date, content_enc FROM briefs WHERE id = ?").get(id) as Record<string, string>;
    expect([row.slot, row.local_date]).toEqual(["18:00", "2026-09-27"]);
    expect(row.content_enc).not.toContain("Airtel"); // stored encrypted
    const briefed = ctx.db.prepare("SELECT id FROM messages WHERE brief_id = ? ORDER BY id").all(id) as { id: number }[];
    expect(briefed.map((r) => r.id)).toEqual([2, 3]);

    // Next brief: nothing new, no AI call.
    const again = fakeOpenAI(() => ({}));
    const second = await generateBrief(ctx, { trigger: "manual", localDate: "2026-09-27", slot: "18:05" }, again.client);
    expect(second.content.itemCount).toBe(0);
    expect(again.prompts).toHaveLength(0);
    expect(second.content.headline).toMatch(/1 still needs you/);
  });

  it("flags a brief built from stale mail", async () => {
    const ctx = makeCtx();
    const { content } = await generateBrief(ctx, { trigger: "manual", localDate: "2026-09-27", slot: "08:30", syncFailed: true }, fakeOpenAI(() => ({})).client);
    expect(content.overview).toMatch(/^Couldn't reach iCloud/);
  });
});

describe("brief helpers", () => {
  it("orders sections by screener category order", () => {
    const item = (emailId: number, category: string) => ({ emailId, category, from: "a", subject: "s", summary: "x", highlight: null, date: emailId });
    expect(groupSections([item(1, "promotions"), item(2, "calendar"), item(3, "calendar")]).map((s) => [s.label, s.items.map((i) => i.emailId)])).toEqual([
      ["Calendar", [3, 2]],
      ["Promotions", [1]],
    ]);
  });

  it("rejects malformed overview output", () => {
    expect(() => parseOverview('{"headline": 1}', new Set())).toThrow();
  });

  it("converts version-1 briefs for display", () => {
    const v1 = {
      headline: "h",
      summary: "s",
      highlights: [{ emailId: 1, priority: "high", why: "w" }],
      actionItems: [],
      newsletters: [{ emailId: 2, summary: "n" }],
    };
    const v2 = normalizeBrief(v1, (id) => (id === 1 ? { from: "Rahul", subject: "Contract", date: 5 } : null));
    expect(v2.sections.map((s) => s.label)).toEqual(["Needs a look", "Newsletters"]);
    expect(v2.sections[0]!.items[0]).toMatchObject({ from: "Rahul", summary: "w" });
    expect(v2.sections[1]!.items[0]!.from).toBe("Email no longer stored");
  });
});

describe("scheduler", () => {
  it("computes local time in a time zone", () => {
    const d = new Date("2026-01-15T14:00:00Z");
    expect(localNow("Asia/Kolkata", d)).toEqual({ date: "2026-01-15", time: "19:30" });
  });

  const base = { times: ["08:30", "18:00"], isDone: () => false, attempts: null, nowMs: 1_000_000_000 };
  const local = (time: string) => ({ date: "2026-01-15", time });
  it("picks the most recent passed slot", () => {
    expect(dueSlot({ ...base, local: local("08:00") })).toBeNull();
    expect(dueSlot({ ...base, local: local("08:30") })).toBe("08:30");
    expect(dueSlot({ ...base, local: local("17:59") })).toBe("08:30");
    expect(dueSlot({ ...base, local: local("23:00") })).toBe("18:00"); // missed morning isn't replayed
  });

  it("skips done slots and backs off retries", () => {
    expect(dueSlot({ ...base, local: local("18:10"), isDone: (k) => k === "2026-01-15 18:00" })).toBeNull();
    const recent = { key: "2026-01-15 18:00", count: 1, lastAt: base.nowMs - 60_000 };
    expect(dueSlot({ ...base, local: local("18:10"), attempts: recent })).toBeNull();
    expect(dueSlot({ ...base, local: local("18:30"), attempts: { ...recent, lastAt: base.nowMs - 16 * 60_000 } })).toBe("18:00");
    expect(dueSlot({ ...base, local: local("18:30"), attempts: { ...recent, count: 5, lastAt: 0 } })).toBeNull();
  });
});
