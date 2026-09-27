import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BriefContent, generateBrief } from "./brief.js";
import type { AppContext } from "./context.js";
import { kvGet } from "./db.js";
import { syncMail } from "./mail.js";
import { sendPushToAll } from "./push.js";

const IdParam = z.object({ id: z.coerce.number().int().positive() });

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().optional(),
  mailbox: z.string().max(200).optional(),
});

const PushSubscription = z.object({
  endpoint: z.url().refine((u) => u.startsWith("https://"), "https only"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, cipher, config } = ctx;

  app.get("/api/status", async () => {
    const lastErr = kvGet(db, "last_sync_error");
    return {
      lastSyncAt: Number(kvGet(db, "last_sync_at") ?? 0) || null,
      lastSyncError: lastErr ? JSON.parse(lastErr) : null,
      briefTime: config.BRIEF_TIME,
      briefTimezone: config.BRIEF_TIMEZONE,
      mailboxes: config.MAILBOXES,
      pushDevices: (db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n,
    };
  });

  // ---------- Mail ----------

  app.get("/api/messages", async (req, reply) => {
    const q = ListQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "Bad query" });
    const { limit, before, mailbox } = q.data;
    const rows = db
      .prepare(
        `SELECT id, mailbox, from_name, from_address, subject_enc, snippet_enc, date, seen, flagged, has_attachments
         FROM messages
         WHERE (@before IS NULL OR date < @before) AND (@mailbox IS NULL OR mailbox = @mailbox)
         ORDER BY date DESC LIMIT @limit`,
      )
      .all({ before: before ?? null, mailbox: mailbox ?? null, limit }) as Record<string, unknown>[];
    return {
      messages: rows.map((r) => ({
        id: r.id,
        mailbox: r.mailbox,
        fromName: r.from_name,
        fromAddress: r.from_address,
        subject: cipher.decryptNullable(r.subject_enc as string | null),
        snippet: cipher.decryptNullable(r.snippet_enc as string | null),
        date: r.date,
        seen: r.seen === 1,
        flagged: r.flagged === 1,
        hasAttachments: r.has_attachments === 1,
      })),
    };
  });

  app.get("/api/messages/:id", async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "Bad id" });
    const r = db.prepare("SELECT * FROM messages WHERE id = ?").get(p.data.id) as Record<string, unknown> | undefined;
    if (!r) return reply.code(404).send({ error: "Not found" });
    return {
      id: r.id,
      mailbox: r.mailbox,
      fromName: r.from_name,
      fromAddress: r.from_address,
      to: JSON.parse(r.to_json as string),
      subject: cipher.decryptNullable(r.subject_enc as string | null),
      text: cipher.decryptNullable(r.text_enc as string | null),
      html: cipher.decryptNullable(r.html_enc as string | null),
      date: r.date,
      seen: r.seen === 1,
      flagged: r.flagged === 1,
      hasAttachments: r.has_attachments === 1,
    };
  });

  app.post("/api/sync", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (_req, reply) => {
    try {
      return await syncMail(ctx);
    } catch (err) {
      return reply.code(502).send({ error: `Sync failed: ${(err as Error).message}` });
    }
  });

  // ---------- Briefs ----------

  app.get("/api/briefs", async () => {
    const rows = db
      .prepare("SELECT id, created_at, message_count, trigger, content_enc FROM briefs ORDER BY created_at DESC LIMIT 60")
      .all() as { id: number; created_at: number; message_count: number; trigger: string; content_enc: string }[];
    return {
      briefs: rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        messageCount: r.message_count,
        trigger: r.trigger,
        headline: (JSON.parse(cipher.decrypt(r.content_enc)) as BriefContent).headline,
      })),
    };
  });

  app.get("/api/briefs/:id", async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "Bad id" });
    const r = db.prepare("SELECT * FROM briefs WHERE id = ?").get(p.data.id) as Record<string, unknown> | undefined;
    if (!r) return reply.code(404).send({ error: "Not found" });
    const content = JSON.parse(cipher.decrypt(r.content_enc as string)) as BriefContent;

    // Attach sender/subject for referenced emails that are still stored locally.
    const ids = [...new Set([...content.highlights.map((h) => h.emailId), ...content.actionItems.flatMap((a) => (a.emailId ? [a.emailId] : []))])];
    const emails: Record<number, { fromName: unknown; fromAddress: unknown; subject: string | null }> = {};
    const stmt = db.prepare("SELECT id, from_name, from_address, subject_enc FROM messages WHERE id = ?");
    for (const id of ids) {
      const m = stmt.get(id) as Record<string, unknown> | undefined;
      if (m) emails[id] = { fromName: m.from_name, fromAddress: m.from_address, subject: cipher.decryptNullable(m.subject_enc as string | null) };
    }
    return {
      id: r.id,
      createdAt: r.created_at,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      messageCount: r.message_count,
      model: r.model,
      trigger: r.trigger,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      content,
      emails,
    };
  });

  app.post("/api/briefs", { config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } }, async (req, reply) => {
    try {
      const syncFailed = await syncMail(ctx).then(
        () => false,
        (err) => {
          req.log.warn({ err: (err as Error).message }, "pre-brief sync failed, using cached mail");
          return true;
        },
      );
      const { id } = await generateBrief(ctx, "manual", { syncFailed });
      return { id };
    } catch (err) {
      req.log.error({ err }, "manual brief failed");
      return reply.code(502).send({ error: `Brief failed: ${(err as Error).message}` });
    }
  });

  // ---------- Web Push ----------

  app.get("/api/push/vapid-public-key", async () => ({ key: config.VAPID_PUBLIC_KEY }));

  app.post("/api/push/subscribe", async (req, reply) => {
    const s = PushSubscription.safeParse(req.body);
    if (!s.success) return reply.code(400).send({ error: "Bad subscription" });
    db.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
    ).run(s.data.endpoint, s.data.keys.p256dh, s.data.keys.auth, (req.headers["user-agent"] ?? "").slice(0, 300), Date.now());
    return { ok: true };
  });

  app.post("/api/push/unsubscribe", async (req, reply) => {
    const body = z.object({ endpoint: z.string().max(2000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Bad request" });
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(body.data.endpoint);
    return { ok: true };
  });

  app.post("/api/push/test", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async () =>
    sendPushToAll(ctx, { title: "iMailCatchUp", body: "Notifications are working.", url: "/#/settings", tag: "test" }),
  );
}
