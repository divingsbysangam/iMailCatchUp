/**
 * Shrinks email content before it is sent to the AI for the evening brief.
 * Pure functions, no I/O. Everything here only affects what the model sees, never what
 * the app stores or shows you.
 */

/** Minimum real content (non-whitespace chars) that must precede a reply marker for us to cut there.
 *  Guards against cutting forwards, where the useful content sits *below* the marker. */
const MIN_OWN_CONTENT = 20;

// Markers that start the quoted history of a reply.
const REPLY_MARKERS: RegExp[] = [
  /^On [^\n]{0,200}(?:\n[^\n]{0,200})?wrote:[ \t]*$/m, // Gmail / Apple Mail
  /^-{2,}[ \t]*Original Message[ \t]*-{2,}/im, // Outlook (classic)
  /^From:[^\n]+\n(?:Sent|Date):[^\n]+/m, // Outlook header block
  /^_{10,}[ \t]*$/m, // Outlook separator line
];

const SIGNATURE_DELIMITER = /^-- ?$/m; // RFC 3676 "-- " signature separator
const MOBILE_FOOTER = /^Sent from my [^\n]{1,40}$/gim;
const URL = /(?:https?:\/\/|www\.)[^\s<>()"']+/gi;
const MAILTO = /<mailto:[^>]+>/gi;

function nonWhitespaceLength(s: string): number {
  return s.replace(/\s/g, "").length;
}

/** Cut `text` at the earliest match of any regex, if enough real content comes before it. */
function cutAtFirst(text: string, markers: RegExp[]): string {
  let cut = text.length;
  for (const re of markers) {
    const m = re.exec(text);
    if (m && m.index < cut && nonWhitespaceLength(text.slice(0, m.index)) >= MIN_OWN_CONTENT) cut = m.index;
  }
  return text.slice(0, cut);
}

/**
 * Removes quoted reply history, "> " quoted lines, signatures, mobile footers and URLs,
 * collapses whitespace and truncates to `maxChars` on a word boundary.
 */
export function trimBody(raw: string, maxChars: number): string {
  let text = raw.replace(/\r\n?/g, "\n");
  text = cutAtFirst(text, REPLY_MARKERS);
  text = text
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
  text = cutAtFirst(text, [SIGNATURE_DELIMITER]);
  text = text.replace(MOBILE_FOOTER, "").replace(MAILTO, "").replace(URL, "[link]");
  text = text.replace(/(?:\[link\]\s*){2,}/g, "[link] ").replace(/\s+/g, " ").trim();

  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  return `${lastSpace > maxChars * 0.8 ? slice.slice(0, lastSpace) : slice}…`;
}

const BULK_SENDER = /^(?:no-?reply|do-?not-?reply|newsletters?|news|notifications?|notify|mailer(?:-daemon)?|marketing|promo(?:tions)?|updates|digest|alerts?)[@+._-]/i;

/**
 * Newsletters, marketing and automated notifications. Uses standard mailing-list / auto-generated
 * headers (RFC 2369, RFC 2919, RFC 3834) plus common no-reply sender names.
 */
export function isBulkMail(headers: Map<string, unknown> | null, fromAddress: string | null | undefined): boolean {
  if (fromAddress && BULK_SENDER.test(fromAddress)) return true;
  if (!headers) return false;
  if (headers.has("list-unsubscribe") || headers.has("list-id")) return true;
  const precedence = String(headers.get("precedence") ?? "").toLowerCase();
  if (["bulk", "list", "junk"].includes(precedence)) return true;
  const auto = headers.get("auto-submitted");
  if (auto && String(auto).toLowerCase() !== "no") return true;
  return false;
}
