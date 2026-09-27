import { simpleParser, type Attachment, type ParsedMail } from "mailparser";

/** Bumped when the stored rendering changes; older rows are re-fetched from iCloud when opened. */
export const RENDER_VERSION = 2;

export interface AttachmentInfo {
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

export interface MessageView {
  parsed: ParsedMail;
  /** HTML with embedded (cid:) images inlined as data: URLs, like a mail app shows them. */
  html: string | null;
  /** Files listed for download: everything except images the HTML embeds. */
  files: Attachment[];
}

/** Embedded images larger than this stay as downloads instead of being inlined. */
const MAX_INLINE_BYTES = 2 * 1024 * 1024;

const cidOf = (a: Attachment) => (a.contentId ?? a.cid ?? "").replace(/^<|>$/g, "");

export async function parseMessage(source: Buffer): Promise<MessageView> {
  const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  let html = typeof parsed.html === "string" ? parsed.html : null;
  const files: Attachment[] = [];
  for (const a of parsed.attachments) {
    const cid = cidOf(a);
    const ref = cid && html ? new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=["')\\s>])`, "gi") : null;
    if (html && ref && ref.test(html) && a.contentType.startsWith("image/") && a.content.length <= MAX_INLINE_BYTES) {
      html = html.replace(ref, `data:${a.contentType};base64,${a.content.toString("base64")}`);
    } else {
      files.push(a);
    }
  }
  return { parsed, html, files };
}

export function attachmentList(view: Pick<MessageView, "files">): AttachmentInfo[] {
  return view.files.map((a, index) => ({
    index,
    filename: safeFilename(a.filename, a.contentType, index),
    contentType: a.contentType || "application/octet-stream",
    size: a.size ?? a.content.length,
  }));
}

/** A filename safe to show and to put in a Content-Disposition header. */
export function safeFilename(name: string | undefined, contentType: string | undefined, index: number): string {
  const cleaned = (name ?? "")
    .replace(/[\u0000-\u001f\u007f"\\/]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  if (cleaned) return cleaned;
  const ext = (contentType ?? "").split("/")[1]?.split(/[;+]/)[0]?.replace(/[^a-z0-9]/gi, "").slice(0, 8);
  return `attachment-${index + 1}${ext ? `.${ext}` : ""}`;
}

/**
 * Types the browser may open from a download. Anything else is sent as application/octet-stream, so an
 * HTML or SVG attachment can never render on this app's origin.
 */
const OPENABLE = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "text/plain",
  "text/csv",
  "text/calendar",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function downloadType(contentType: string | undefined): string {
  const t = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return OPENABLE.has(t) ? t : "application/octet-stream";
}

/** RFC 6266 / 5987 Content-Disposition with an ASCII fallback. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/[%;]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
