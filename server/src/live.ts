import type { FetchMessageObject, ImapFlow } from "imapflow";
import type { AppContext } from "./context.js";
import { imapClient } from "./mail.js";
import { attachmentList, parseMessage, type AttachmentInfo, type MessageView } from "./view.js";

/**
 * Live, read-only access to any iCloud folder: browse, search and open mail straight from iCloud.
 * Nothing here is stored in the app, screened by the AI or marked read (fetches use BODY.PEEK).
 */

export interface FolderInfo {
  path: string;
  name: string;
  specialUse: string | null;
  messages: number | null;
  unseen: number | null;
}

export interface LiveSummary {
  folder: string;
  uid: number;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  date: number;
  seen: boolean;
  flagged: boolean;
}

export interface LiveMessage extends LiveSummary {
  to: { name?: string; address?: string }[];
  html: string | null;
  text: string | null;
  attachments: AttachmentInfo[];
}

export class NotFoundError extends Error {}

const PAGE = 50;
const SEARCH_PER_FOLDER = 30;
const SEARCH_MAX = 60;
const ORDER: Record<string, number> = { "\\Inbox": 0, "\\Flagged": 1, "\\Drafts": 2, "\\Sent": 3, "\\Archive": 4, "\\Junk": 6, "\\Trash": 7 };

async function withClient<T>(ctx: AppContext, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const client = imapClient(ctx, { disableAutoIdle: true });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

async function inFolder<T>(client: ImapFlow, folder: string, fn: () => Promise<T>): Promise<T> {
  let lock;
  try {
    lock = await client.getMailboxLock(folder, { readOnly: true });
  } catch {
    throw new NotFoundError("Folder not found");
  }
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

function summaryOf(folder: string, m: FetchMessageObject): LiveSummary {
  const from = m.envelope?.from?.[0];
  return {
    folder,
    uid: m.uid,
    fromName: from?.name || null,
    fromAddress: from?.address || null,
    subject: m.envelope?.subject || null,
    date: new Date(m.envelope?.date ?? m.internalDate ?? 0).getTime() || 0,
    seen: m.flags?.has("\\Seen") ?? false,
    flagged: m.flags?.has("\\Flagged") ?? false,
  };
}

async function selectableFolders(client: ImapFlow, withStatus: boolean): Promise<FolderInfo[]> {
  const list = await client.list(withStatus ? { statusQuery: { messages: true, unseen: true } } : {});
  return list
    .filter((f) => !f.flags.has("\\Noselect") && !f.flags.has("\\NonExistent"))
    .map((f) => ({
      path: f.path,
      name: f.specialUse === "\\Inbox" || f.path.toUpperCase() === "INBOX" ? "Inbox" : f.name,
      specialUse: f.path.toUpperCase() === "INBOX" ? "\\Inbox" : (f.specialUse ?? null),
      messages: f.status?.messages ?? null,
      unseen: f.status?.unseen ?? null,
    }))
    .sort((a, b) => (ORDER[a.specialUse ?? ""] ?? 5) - (ORDER[b.specialUse ?? ""] ?? 5) || a.path.localeCompare(b.path));
}

export function listFolders(ctx: AppContext): Promise<FolderInfo[]> {
  return withClient(ctx, (c) => selectableFolders(c, true));
}

/** Newest first, PAGE at a time; `offset` counts messages already shown. */
export function listFolder(ctx: AppContext, folder: string, offset: number): Promise<{ messages: LiveSummary[]; total: number }> {
  return withClient(ctx, (c) =>
    inFolder(c, folder, async () => {
      const total = c.mailbox ? c.mailbox.exists : 0;
      const end = total - offset;
      if (end < 1) return { messages: [], total };
      const start = Math.max(1, end - PAGE + 1);
      const out: LiveSummary[] = [];
      for await (const m of c.fetch(`${start}:${end}`, { uid: true, envelope: true, flags: true, internalDate: true })) out.push(summaryOf(folder, m));
      return { messages: out.sort((a, b) => b.date - a.date), total };
    }),
  );
}

/** Sender, subject or body contains `q`, in one folder or across every folder. Newest first. */
export function searchMail(ctx: AppContext, q: string, folder?: string): Promise<{ messages: LiveSummary[]; searched: number }> {
  return withClient(ctx, async (c) => {
    const folders = folder ? [folder] : (await selectableFolders(c, false)).map((f) => f.path);
    const found: LiveSummary[] = [];
    for (const path of folders) {
      try {
        await inFolder(c, path, async () => {
          const uids = await c.search({ or: [{ from: q }, { subject: q }, { body: q }] }, { uid: true });
          const newest = (uids || []).slice(-SEARCH_PER_FOLDER);
          if (!newest.length) return;
          for await (const m of c.fetch(newest.join(","), { uid: true, envelope: true, flags: true, internalDate: true }, { uid: true }))
            found.push(summaryOf(path, m));
        });
      } catch (err) {
        if (folder) throw err;
        ctx.log.warn({ folder: path, err: (err as Error).message }, "search skipped a folder");
      }
    }
    return { messages: found.sort((a, b) => b.date - a.date).slice(0, SEARCH_MAX), searched: folders.length };
  });
}

async function fetchLive(ctx: AppContext, folder: string, uid: number): Promise<{ summary: LiveSummary; view: MessageView }> {
  return withClient(ctx, (c) =>
    inFolder(c, folder, async () => {
      const m = await c.fetchOne(String(uid), { uid: true, envelope: true, flags: true, internalDate: true, source: true }, { uid: true });
      if (!m || !m.source) throw new NotFoundError("Email not found");
      return { summary: summaryOf(folder, m), view: await parseMessage(m.source) };
    }),
  );
}

export async function getLiveMessage(ctx: AppContext, folder: string, uid: number): Promise<LiveMessage> {
  const { summary, view } = await fetchLive(ctx, folder, uid);
  const to = (Array.isArray(view.parsed.to) ? view.parsed.to : view.parsed.to ? [view.parsed.to] : []).flatMap((a) =>
    a.value.map((v) => ({ name: v.name, address: v.address })),
  );
  return { ...summary, to, html: view.html, text: view.parsed.text ?? null, attachments: attachmentList(view) };
}

export async function getLiveAttachment(ctx: AppContext, folder: string, uid: number, index: number) {
  const { view } = await fetchLive(ctx, folder, uid);
  const file = view.files[index];
  const info = attachmentList(view)[index];
  if (!file || !info) throw new NotFoundError("Attachment not found");
  return { file, info };
}
