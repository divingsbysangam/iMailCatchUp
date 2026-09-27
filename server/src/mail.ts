import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { AppContext } from "./context.js";
import { kvSet } from "./db.js";
import { isBulkMail } from "./trim.js";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;
const FETCH_BATCH = 25;

function snippetOf(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

let running: Promise<SyncResult> | null = null;

export interface SyncResult {
  added: number;
  removed: number;
  mailboxes: string[];
}

/** Sync recent mail from iCloud into the local store. Concurrent callers share one run. */
export function syncMail(ctx: AppContext): Promise<SyncResult> {
  running ??= doSync(ctx).finally(() => {
    running = null;
  });
  return running;
}

async function doSync(ctx: AppContext): Promise<SyncResult> {
  const { config, db, cipher, log } = ctx;
  const client = new ImapFlow({
    host: config.IMAP_HOST,
    port: config.IMAP_PORT,
    secure: true,
    auth: { user: config.ICLOUD_EMAIL, pass: config.ICLOUD_APP_PASSWORD },
    logger: false,
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    socketTimeout: 5 * 60_000,
    // TLS certificate verification stays ON (the default). Never disable it.
  });

  const result: SyncResult = { added: 0, removed: 0, mailboxes: [] };
  const since = new Date(Date.now() - config.SYNC_DAYS * 24 * 3600 * 1000);

  try {
    await client.connect();
    for (const mailbox of config.MAILBOXES) {
      // readOnly: this app never changes anything in your iCloud mailbox (no flags, moves or deletes).
      const lock = await client.getMailboxLock(mailbox, { readOnly: true });
      try {
        if (!client.mailbox) continue;
        const uidValidity = client.mailbox.uidValidity.toString();

        // UIDVALIDITY change means old UIDs are meaningless: drop our copy of that mailbox.
        db.prepare("DELETE FROM messages WHERE mailbox = ? AND uid_validity != ?").run(mailbox, uidValidity);

        const found = (await client.search({ since }, { uid: true })) || [];
        const remoteUids = new Set(found);
        const localRows = db
          .prepare("SELECT uid FROM messages WHERE mailbox = ? AND uid_validity = ?")
          .all(mailbox, uidValidity) as { uid: number }[];
        const localUids = new Set(localRows.map((r) => r.uid));

        // Messages that disappeared remotely (deleted/moved) or aged out of the sync window.
        const del = db.prepare("DELETE FROM messages WHERE mailbox = ? AND uid_validity = ? AND uid = ?");
        for (const uid of localUids) {
          if (!remoteUids.has(uid)) {
            del.run(mailbox, uidValidity, uid);
            result.removed++;
          }
        }

        // Refresh flags for messages we already have.
        const existing = [...remoteUids].filter((u) => localUids.has(u));
        if (existing.length) {
          const upd = db.prepare(
            "UPDATE messages SET seen = ?, flagged = ? WHERE mailbox = ? AND uid_validity = ? AND uid = ?",
          );
          for await (const msg of client.fetch(existing.join(","), { flags: true }, { uid: true })) {
            upd.run(msg.flags?.has("\\Seen") ? 1 : 0, msg.flags?.has("\\Flagged") ? 1 : 0, mailbox, uidValidity, msg.uid);
          }
        }

        // Download new messages.
        const fresh = [...remoteUids].filter((u) => !localUids.has(u));
        const insert = db.prepare(`
          INSERT OR IGNORE INTO messages
            (mailbox, uid_validity, uid, message_id, from_name, from_address, to_json,
             subject_enc, snippet_enc, text_enc, html_enc, date, seen, flagged, has_attachments, is_bulk, size, synced_at)
          VALUES
            (@mailbox, @uidValidity, @uid, @messageId, @fromName, @fromAddress, @toJson,
             @subject, @snippet, @text, @html, @date, @seen, @flagged, @hasAttachments, @isBulk, @size, @syncedAt)
        `);
        for (let i = 0; i < fresh.length; i += FETCH_BATCH) {
          const batch = fresh.slice(i, i + FETCH_BATCH);
          for await (const msg of client.fetch(
            batch.join(","),
            { uid: true, flags: true, envelope: true, internalDate: true, size: true, source: { maxLength: MAX_SOURCE_BYTES } },
            { uid: true },
          )) {
            if (!msg.source) continue;
            const parsed = await simpleParser(msg.source, { skipImageLinks: true, skipTextToHtml: true });
            const text = (parsed.text ?? "").slice(0, MAX_TEXT_CHARS);
            const from = parsed.from?.value[0];
            const to = (Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : []).flatMap((a) =>
              a.value.map((v) => ({ name: v.name, address: v.address })),
            );
            const date = parsed.date ?? (msg.internalDate ? new Date(msg.internalDate) : new Date());
            insert.run({
              mailbox,
              uidValidity,
              uid: msg.uid,
              messageId: parsed.messageId ?? null,
              fromName: from?.name || null,
              fromAddress: from?.address || null,
              toJson: JSON.stringify(to),
              subject: cipher.encryptNullable(parsed.subject ?? null),
              snippet: cipher.encrypt(snippetOf(text)),
              text: cipher.encrypt(text),
              html: cipher.encryptNullable(typeof parsed.html === "string" ? parsed.html : null),
              date: date.getTime(),
              seen: msg.flags?.has("\\Seen") ? 1 : 0,
              flagged: msg.flags?.has("\\Flagged") ? 1 : 0,
              hasAttachments: parsed.attachments.length > 0 ? 1 : 0,
              isBulk: isBulkMail(parsed.headers, from?.address) ? 1 : 0,
              size: msg.size ?? null,
              syncedAt: Date.now(),
            });
            result.added++;
          }
        }
        result.mailboxes.push(mailbox);
      } finally {
        lock.release();
      }
    }
    await client.logout();
  } catch (err) {
    client.close();
    kvSet(db, "last_sync_error", JSON.stringify({ at: Date.now(), message: (err as Error).message }));
    log.error({ err }, "mail sync failed");
    throw err;
  }

  // Data minimisation: messages that left the sync window were removed above; also drop
  // mailboxes that are no longer configured.
  const placeholders = config.MAILBOXES.map(() => "?").join(",");
  db.prepare(`DELETE FROM messages WHERE mailbox NOT IN (${placeholders})`).run(...config.MAILBOXES);
  kvSet(db, "last_sync_at", String(Date.now()));
  db.prepare("DELETE FROM kv WHERE key = 'last_sync_error'").run();
  log.info(result, "mail sync complete");
  return result;
}
