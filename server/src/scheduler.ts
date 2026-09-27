import { generateBrief } from "./brief.js";
import type { AppContext } from "./context.js";
import { kvGet, kvSet } from "./db.js";
import { refreshMail } from "./pipeline.js";

const RETRY_AFTER_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_SLOT = 5;

/** Local date ("YYYY-MM-DD") and time ("HH:MM") in the given IANA time zone. */
export function localNow(timeZone: string, now = new Date()): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export interface SlotAttempts {
  key: string;
  count: number;
  lastAt: number;
}

/**
 * Pure decision: which brief slot (if any) should run now? Only the most recent slot that has passed
 * today is considered, so a server that was down all day sends one brief on return, not a backlog.
 */
export function dueSlot(opts: {
  local: { date: string; time: string };
  times: string[];
  isDone: (key: string) => boolean;
  attempts: SlotAttempts | null;
  nowMs: number;
}): string | null {
  const { local, times, isDone, attempts, nowMs } = opts;
  const passed = times.filter((t) => t <= local.time).sort();
  const slot = passed[passed.length - 1];
  if (!slot) return null;
  const key = `${local.date} ${slot}`;
  if (isDone(key)) return null;
  if (attempts && attempts.key === key) {
    if (attempts.count >= MAX_ATTEMPTS_PER_SLOT) return null;
    if (nowMs - attempts.lastAt < RETRY_AFTER_MS) return null;
  }
  return slot;
}

/** Refresh mail, then build a brief for the given slot. Sync failure still produces a (flagged) brief. */
export async function runBrief(ctx: AppContext, trigger: "scheduled" | "manual", localDate: string, slot: string) {
  const syncFailed = await refreshMail(ctx).then(
    () => false,
    (err) => {
      ctx.log.warn({ err: (err as Error).message }, "pre-brief sync failed, using cached mail");
      return true;
    },
  );
  return generateBrief(ctx, { trigger, localDate, slot, syncFailed });
}

export function startScheduler(ctx: AppContext): () => void {
  const { config, db, log } = ctx;
  let briefRunning = false;

  const refresh = () => refreshMail(ctx).catch(() => {}); // errors are logged + recorded in kv
  const syncTimer = setInterval(refresh, config.SYNC_INTERVAL_MINUTES * 60 * 1000);
  void refresh();

  const tick = async () => {
    if (briefRunning) return;
    const local = localNow(config.BRIEF_TIMEZONE);
    const attemptsRaw = kvGet(db, "brief_attempts");
    const attempts = attemptsRaw ? (JSON.parse(attemptsRaw) as SlotAttempts) : null;
    const slot = dueSlot({
      local,
      times: config.briefTimes,
      isDone: (key) => kvGet(db, `brief_done:${key}`) !== null,
      attempts,
      nowMs: Date.now(),
    });
    if (!slot) return;

    briefRunning = true;
    const key = `${local.date} ${slot}`;
    const count = attempts?.key === key ? attempts.count + 1 : 1;
    kvSet(db, "brief_attempts", JSON.stringify({ key, count, lastAt: Date.now() }));
    try {
      await runBrief(ctx, "scheduled", local.date, slot);
      kvSet(db, `brief_done:${key}`, String(Date.now()));
    } catch (err) {
      log.error({ err, attempt: count, slot }, "scheduled brief failed");
    } finally {
      briefRunning = false;
    }
  };
  const briefTimer = setInterval(() => void tick(), 60 * 1000);
  // First tick after the initial refresh has had a moment to screen new mail.
  const firstTick = setTimeout(() => void tick(), 30 * 1000);

  return () => {
    clearInterval(syncTimer);
    clearInterval(briefTimer);
    clearTimeout(firstTick);
  };
}
