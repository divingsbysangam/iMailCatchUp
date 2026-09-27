import type { AppContext } from "./context.js";
import { archiveBriefMail, flushSeen, syncMail } from "./mail.js";
import { triageMessages } from "./triage.js";

export interface RefreshResult {
  added: number;
  removed: number;
  triaged: number;
  archived: number;
}

let running: Promise<RefreshResult> | null = null;

/**
 * Sync from iCloud, screen new mail with the AI, then (if AUTO_ARCHIVE) move brief-bound mail out of
 * the inbox. Sync failure throws; screening/archiving failures are logged and retried next run.
 * Concurrent callers share one run.
 */
export function refreshMail(ctx: AppContext): Promise<RefreshResult> {
  running ??= (async () => {
    try {
      await flushSeen(ctx); // first, so iCloud and the app agree before syncing
    } catch {
      // logged in flushSeen; sync still skips queued emails
    }
    const synced = await syncMail(ctx);
    let triaged = 0;
    let archived = 0;
    try {
      triaged = (await triageMessages(ctx)).triaged;
    } catch (err) {
      ctx.log.error({ err }, "triage failed");
    }
    try {
      archived = (await archiveBriefMail(ctx)).moved;
    } catch {
      // already logged in archiveBriefMail
    }
    return { added: synced.added, removed: synced.removed, triaged, archived };
  })().finally(() => {
    running = null;
  });
  return running;
}
