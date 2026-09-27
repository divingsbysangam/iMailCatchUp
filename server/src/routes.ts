import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BriefContentV2, BriefItem } from "./brief.js";
import { categoryLabel, slotLabel } from "./categories.js";
import type { AppContext } from "./context.js";
import { kvGet } from "./db.js";
import { refreshMail } from "./pipeline.js";
import { sendPushToAll } from "./push.js";
import { localNow, runBrief } from "./scheduler.js";

const IdParam = z.object({ id: z.coerce.number().int().positive() });
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ListQuery = z.object({
  view: z.enum(["needs", "all"]).default("needs"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().optional(),
});

const PushSubscription = z.object({
  endpoint: z.url().refine((u) => u.startsWith("https://"), "https only"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

const LEGACY_PRIORITY_SECTIONS: Record<string, string> = { high: "Needs a look", medium: "Worth knowing", low: "Low priority" };

/**
 * Briefs made before the screener (version 1) are converted on read, so the UI only knows one shape.
 * `lookup` supplies sender/subject for emails still stored locally.
 */
export function normalizeBrief(
  raw: unknown,
  lookup: (id: number) => { from: string; subject: string; date: number } | null,
): BriefContentV2 {
  const c = raw as Record<string, unknown>;
  if (c.version === 2) return c as unknown as BriefContentV2;
  const item = (emailId: number, summary: string): BriefItem => {
    const e = lookup(emailId);
    return { emailId, from: e?.from ?? "Email no longer stored", subject: e?.subject ?? "", summary, highlight: null, date: e?.date ?? 0 };
  };
  const highlights = (c.highlights as { emailId: number; priority: string; why: string }[] | undefined) ?? [];
  const newsletters = (c.newsletters as { emailId: number; summary: string }[] | undefined) ?? [];
  const sections = ["high", "medium", "low"]
    .map((p) => ({
      category: `legacy_${p}`,
      label: LEGACY_PRIORITY_SECTIONS[p]!,
      items: highlights.filter((h) => h.priority === p).map((h) => item(h.emailId, h.why)),
    }))
    .concat([{ category: "newsletters", label: categoryLabel("newsletters"), items: newsletters.map((n) => item(n.emailId, n.summary)) }])
    .filter((s) => s.items.length);
  return {
    version: 2,
    headline: String(c.headline ?? ""),
    overview: String(c.summary ?? ""),
    important: [],
    sections,
    itemCount: sections.reduce((n, s) => n + s.items.length, 0),
    needsYou: 0,
  };
}

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, cipher, config } = ctx;

  const localDateOf = (ms: number) => localNow(config.BRIEF_TIMEZONE, new Date(ms)).date;

  app.get("/api/status", async () => {
    const lastErr = kvGet(db, "last_sync_error");
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    return {
      lastSyncAt: Number(kvGet(db, "last_sync_at") ?? 0) || null,
      lastSyncError: lastErr ? JSON.parse(lastErr) : null,
      briefTimes: config.briefTimes.map((t) => ({ time: t, label: slotLabel(t) })),
      briefTimezone: config.BRIEF_TIMEZONE,
      today: localNow(config.BRIEF_TIMEZONE).date,
      mailboxes: config.MAILBOXES,
      unreadOnly: config.SYNC_UNREAD_ONLY,
      autoArchive: config.AUTO_ARCHIVE,
      archiveFolder: config.ARCHIVE_FOLDER,
      counts: {
        needsYou: count("SELECT COUNT(*) AS n FROM messages WHERE action = 'inbox' OR triaged_at IS NULL"),
        waitingForBrief: count("SELECT COUNT(*) AS n FROM messages WHERE action = 'brief' AND brief_id IS NULL"),
        todos: count("SELECT COUNT(*) AS n FROM messages WHERE todo = 1 AND todo_done_at IS NULL"),
      },
      pushDevices: count("SELECT COUNT(*) AS n FROM push_subscriptions"),
    };
  });

  // ---------- Mail ----------

  const summaryRow = (r: Record<string, unknown>) => ({
    id: r.id as number,
    fromName: r.from_name as string | null,
    fromAddress: r.from_address as string | null,
    subject: cipher.decryptNullable(r.subject_enc as string | null),
    snippet: cipher.decryptNullable(r.snippet_enc as string | null),
    summary: cipher.decryptNullable(r.summary_enc as string | null),
    highlight: cipher.decryptNullable(r.highlight_enc as string | null),
    category: r.category as string | null,
    categoryLabel: r.category ? categoryLabel(r.category as string) : null,
    action: r.action as string | null,
    date: r.date as number,
    seen: r.seen === 1,
    flagged: r.flagged === 1,
    hasAttachments: r.has_attachments === 1,
    todo: r.todo === 1,
    todoDoneAt: (r.todo_done_at as number | null) ?? null,
    archived: r.archived === 1,
  });
  const SUMMARY_COLS = `id, from_name, from_address, subject_enc, snippet_enc, summary_enc, highlight_enc, category, action,
    date, seen, flagged, has_attachments, todo, todo_done_at, archived`;

  app.get("/api/messages", async (req, reply) => {
    const q = ListQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "Bad query" });
    const { view, limit, before } = q.data;
    const filter = view === "needs" ? "(action = 'inbox' OR triaged_at IS NULL)" : "archived = 0";
    const rows = db
      .prepare(
        `SELECT ${SUMMARY_COLS} FROM messages
         WHERE ${filter} AND (@before IS NULL OR date < @before)
         ORDER BY date DESC LIMIT @limit`,
      )
      .all({ before: before ?? null, limit }) as Record<string, unknown>[];
    return { messages: rows.map(summaryRow) };
  });

  app.get("/api/messages/:id", async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "Bad id" });
    const r = db.prepare("SELECT * FROM messages WHERE id = ?").get(p.data.id) as Record<string, unknown> | undefined;
    if (!r) return reply.code(404).send({ error: "Not found" });
    return {
      ...summaryRow(r),
      mailbox: r.mailbox,
      to: JSON.parse(r.to_json as string),
      text: cipher.decryptNullable(r.text_enc as string | null),
      html: cipher.decryptNullable(r.html_enc as string | null),
    };
  });

  app.post("/api/messages/:id/todo", async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    const b = z.object({ todo: z.boolean() }).safeParse(req.body);
    if (!p.success || !b.success) return reply.code(400).send({ error: "Bad request" });
    const res = db
      .prepare("UPDATE messages SET todo = ?, todo_done_at = NULL WHERE id = ?")
      .run(b.data.todo ? 1 : 0, p.data.id);
    if (!res.changes) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.post("/api/messages/:id/todo-done", async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    const b = z.object({ done: z.boolean() }).safeParse(req.body);
    if (!p.success || !b.success) return reply.code(400).send({ error: "Bad request" });
    const res = db
      .prepare("UPDATE messages SET todo_done_at = ? WHERE id = ? AND todo = 1")
      .run(b.data.done ? Date.now() : null, p.data.id);
    if (!res.changes) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.get("/api/todos", async () => {
    const rows = db
      .prepare(
        `SELECT ${SUMMARY_COLS} FROM messages WHERE todo = 1
         AND (todo_done_at IS NULL OR todo_done_at > ?)
         ORDER BY todo_done_at IS NOT NULL, date DESC LIMIT 200`,
      )
      .all(Date.now() - 24 * 3600 * 1000) as Record<string, unknown>[];
    return { todos: rows.map(summaryRow) };
  });

  app.post("/api/sync", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (_req, reply) => {
    try {
      return await refreshMail(ctx);
    } catch (err) {
      return reply.code(502).send({ error: `Sync failed: ${(err as Error).message}` });
    }
  });

  // ---------- Briefs ----------

  app.get("/api/briefs", async (req, reply) => {
    const q = z.object({ from: DateStr.optional(), to: DateStr.optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "Bad query" });
    const rows = db
      .prepare(
        "SELECT id, created_at, message_count, trigger, content_enc, local_date, slot, done_at FROM briefs ORDER BY created_at DESC LIMIT 400",
      )
      .all() as {
      id: number;
      created_at: number;
      message_count: number;
      trigger: string;
      content_enc: string;
      local_date: string | null;
      slot: string | null;
      done_at: number | null;
    }[];
    const briefs = rows
      .map((r) => {
        const localDate = r.local_date ?? localDateOf(r.created_at);
        const slot = r.slot ?? localNow(config.BRIEF_TIMEZONE, new Date(r.created_at)).time;
        return {
          id: r.id,
          createdAt: r.created_at,
          localDate,
          slot,
          slotLabel: slotLabel(slot),
          itemCount: r.message_count,
          trigger: r.trigger,
          done: r.done_at !== null,
          headline: (JSON.parse(cipher.decrypt(r.content_enc)) as { headline?: string }).headline ?? "",
        };
      })
      .filter((b) => (!q.data.from || b.localDate >= q.data.from) && (!q.data.to || b.localDate <= q.data.to));
    return { briefs };
  });

  app.get("/api/briefs/:id", async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "Bad id" });
    const r = db.prepare("SELECT * FROM briefs WHERE id = ?").get(p.data.id) as Record<string, unknown> | undefined;
    if (!r) return reply.code(404).send({ error: "Not found" });

    const lookupStmt = db.prepare("SELECT id, from_name, from_address, subject_enc, date FROM messages WHERE id = ?");
    const lookup = (id: number) => {
      const m = lookupStmt.get(id) as Record<string, unknown> | undefined;
      return m
        ? {
            from: (m.from_name as string) || (m.from_address as string) || "Unknown sender",
            subject: cipher.decryptNullable(m.subject_enc as string | null) ?? "",
            date: m.date as number,
          }
        : null;
    };
    const content = normalizeBrief(JSON.parse(cipher.decrypt(r.content_enc as string)), lookup);

    // Live state for each item: still openable? on the to-do list?
    const ids = content.sections.flatMap((s) => s.items.map((i) => i.emailId));
    const stateStmt = db.prepare("SELECT todo, todo_done_at FROM messages WHERE id = ?");
    const live: Record<number, { stored: boolean; todo: boolean }> = {};
    for (const id of ids) {
      const s = stateStmt.get(id) as { todo: number; todo_done_at: number | null } | undefined;
      live[id] = { stored: !!s, todo: !!s && s.todo === 1 && s.todo_done_at === null };
    }
    const createdAt = r.created_at as number;
    const slot = (r.slot as string | null) ?? localNow(config.BRIEF_TIMEZONE, new Date(createdAt)).time;
    return {
      id: r.id,
      createdAt,
      localDate: (r.local_date as string | null) ?? localDateOf(createdAt),
      slot,
      slotLabel: slotLabel(slot),
      trigger: r.trigger,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      done: r.done_at !== null,
      content,
      live,
    };
  });

  app.post("/api/briefs/:id/done", async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    const b = z.object({ done: z.boolean() }).safeParse(req.body);
    if (!p.success || !b.success) return reply.code(400).send({ error: "Bad request" });
    const res = db.prepare("UPDATE briefs SET done_at = ? WHERE id = ?").run(b.data.done ? Date.now() : null, p.data.id);
    if (!res.changes) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.post("/api/briefs", { config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } }, async (req, reply) => {
    try {
      const local = localNow(config.BRIEF_TIMEZONE);
      const { id } = await runBrief(ctx, "manual", local.date, local.time);
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
