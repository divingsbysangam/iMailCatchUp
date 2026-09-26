import { generateBrief } from "./brief.js";
import type { AppContext } from "./context.js";
import { kvGet, kvSet } from "./db.js";
import { syncMail } from "./mail.js";

const RETRY_AFTER_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_DAY = 5;

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

/**
 * Pure decision: should the daily brief run now? Restart-safe: if the server was down at
 * BRIEF_TIME, the brief still goes out as soon as it's back (same local day).
 */
export function isBriefDue(opts: {
  local: { date: string; time: string };
  briefTime: string;
  lastDoneDate: string | null;
  attempts: { date: string; count: number; lastAt: number } | null;
  nowMs: number;
}): boolean {
  const { local, briefTime, lastDoneDate, attempts, nowMs } = opts;
  if (local.time < briefTime) return false;
  if (lastDoneDate === local.date) return false;
  if (attempts && attempts.date === local.date) {
    if (attempts.count >= MAX_ATTEMPTS_PER_DAY) return false;
    if (nowMs - attempts.lastAt < RETRY_AFTER_MS) return false;
  }
  return true;
}

export function startScheduler(ctx: AppContext): () => void {
  const { config, db, log } = ctx;
  let briefRunning = false;

  const sync = () => syncMail(ctx).catch(() => {}); // errors are logged + recorded in kv
  const syncTimer = setInterval(sync, config.SYNC_INTERVAL_MINUTES * 60 * 1000);
  void sync();

  const tick = async () => {
    if (briefRunning) return;
    const local = localNow(config.BRIEF_TIMEZONE);
    const attemptsRaw = kvGet(db, "brief_attempts");
    const attempts = attemptsRaw ? (JSON.parse(attemptsRaw) as { date: string; count: number; lastAt: number }) : null;
    if (
      !isBriefDue({
        local,
        briefTime: config.BRIEF_TIME,
        lastDoneDate: kvGet(db, "brief_last_date"),
        attempts,
        nowMs: Date.now(),
      })
    )
      return;

    briefRunning = true;
    const count = attempts?.date === local.date ? attempts.count + 1 : 1;
    kvSet(db, "brief_attempts", JSON.stringify({ date: local.date, count, lastAt: Date.now() }));
    try {
      const syncFailed = await syncMail(ctx).then(
        () => false,
        (err) => {
          log.warn({ err: (err as Error).message }, "pre-brief sync failed, using cached mail");
          return true;
        },
      );
      await generateBrief(ctx, "scheduled", { syncFailed });
      kvSet(db, "brief_last_date", local.date);
    } catch (err) {
      log.error({ err, attempt: count }, "scheduled brief failed");
    } finally {
      briefRunning = false;
    }
  };
  const briefTimer = setInterval(() => void tick(), 60 * 1000);
  void tick();

  return () => {
    clearInterval(syncTimer);
    clearInterval(briefTimer);
  };
}
