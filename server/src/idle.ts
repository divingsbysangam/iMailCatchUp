import type { AppContext } from "./context.js";
import { imapClient } from "./mail.js";
import { refreshMail } from "./pipeline.js";

/** Wait this long after the first "new mail" signal, so a burst of messages is handled in one run. */
const DEBOUNCE_MS = 20_000;
/** Re-issue IDLE this often; iCloud drops connections that sit in IDLE for too long. */
const MAX_IDLE_MS = 9 * 60_000;
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

/**
 * IMAP_IDLE: keeps one read-only connection on the inbox in IDLE. When iCloud reports new mail, the
 * usual refresh (sync → screen → needs-you alert → archive) runs within about DEBOUNCE_MS. Scheduled
 * polling keeps running as a fallback. Reconnects with backoff if the connection drops.
 */
export function startIdleWatcher(ctx: AppContext): () => void {
  const { config, log } = ctx;
  const mailbox = config.MAILBOXES[0] ?? "INBOX";
  let stopped = false;
  let retryMs = RETRY_MIN_MS;
  let debounce: NodeJS.Timeout | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let running = false;
  let pending = false;
  let client: ReturnType<typeof imapClient> | undefined;

  const refresh = async () => {
    if (running) {
      pending = true; // mail arrived mid-run: go again once this one finishes
      return;
    }
    running = true;
    try {
      const r = await refreshMail(ctx);
      log.info({ added: r.added, triaged: r.triaged }, "new mail handled (IDLE)");
    } catch {
      // logged in syncMail; the next signal or scheduled poll retries
    } finally {
      running = false;
      if (pending && !stopped) {
        pending = false;
        void refresh();
      }
    }
  };

  const onNewMail = () => {
    if (debounce || stopped) return;
    debounce = setTimeout(() => {
      debounce = undefined;
      void refresh();
    }, DEBOUNCE_MS);
  };

  const connect = async () => {
    if (stopped) return;
    const c = imapClient(ctx, { maxIdleTime: MAX_IDLE_MS, socketTimeout: 30 * 60_000, autoIdleDelay: 1_000 });
    client = c;
    c.on("exists", onNewMail);
    c.on("error", (err: Error) => log.warn({ err: err.message }, "IDLE connection error"));
    let gone = false;
    const lost = (why: string) => {
      if (gone || stopped || client !== c) return; // once per connection
      gone = true;
      log.warn({ why, retryInMs: retryMs }, "IDLE connection lost; reconnecting");
      scheduleReconnect();
    };
    c.on("close", () => lost("closed"));
    try {
      await c.connect();
      await c.mailboxOpen(mailbox, { readOnly: true });
      retryMs = RETRY_MIN_MS;
      log.info({ mailbox }, "watching for new mail (IDLE)");
      onNewMail(); // catch anything that arrived while disconnected
    } catch (err) {
      lost((err as Error).message);
      c.close();
    }
  };

  const scheduleReconnect = () => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void connect(), retryMs);
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
  };

  void connect();
  return () => {
    stopped = true;
    clearTimeout(debounce);
    clearTimeout(retryTimer);
    void client?.logout().catch(() => client?.close());
  };
}
