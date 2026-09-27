import type { AppContext } from "./context.js";
import { sendPushToAll } from "./push.js";

/** Only mail that arrived recently is worth an instant alert (not a backlog the screener just reached). */
const FRESH_MS = 24 * 3600 * 1000;

/**
 * NEEDS_YOU_PUSH: one notification for mail the screener just marked as needing you. Everything else
 * waits for the next brief. With BRIEF_PUSH_PREVIEW=false the lock screen shows no sender or subject.
 */
export async function notifyNeedsYou(ctx: AppContext): Promise<{ notified: number }> {
  const { config, db, cipher } = ctx;
  const rows = db
    .prepare(
      `SELECT id, from_name, from_address, subject_enc, date FROM messages
       WHERE action = 'inbox' AND notified_at IS NULL AND seen = 0 ORDER BY date DESC`,
    )
    .all() as { id: number; from_name: string | null; from_address: string | null; subject_enc: string | null; date: number }[];
  if (!rows.length) return { notified: 0 };

  const now = Date.now();
  db.transaction(() => rows.forEach((r) => db.prepare("UPDATE messages SET notified_at = ? WHERE id = ?").run(now, r.id)))();
  const fresh = rows.filter((r) => now - r.date < FRESH_MS);
  if (!config.NEEDS_YOU_PUSH || !fresh.length) return { notified: 0 };

  const first = fresh[0]!;
  const from = first.from_name || first.from_address || "Someone";
  const payload =
    fresh.length === 1
      ? {
          title: config.BRIEF_PUSH_PREVIEW ? `Needs you · ${from}` : "An email needs you",
          body: config.BRIEF_PUSH_PREVIEW ? (cipher.decryptNullable(first.subject_enc) ?? "(no subject)").slice(0, 160) : "Open Surface to see it.",
          url: `/#/messages/${first.id}`,
        }
      : {
          title: `${fresh.length} emails need you`,
          body: config.BRIEF_PUSH_PREVIEW ? `Latest from ${from}` : "Open Surface to see them.",
          url: "/#/needs",
        };
  await sendPushToAll(ctx, { ...payload, tag: "needs-you" });
  ctx.log.info({ count: fresh.length }, "needs-you notification sent");
  return { notified: fresh.length };
}
