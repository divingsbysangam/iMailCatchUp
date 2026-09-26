import DOMPurify from "dompurify";
import { useEffect, useMemo, useState } from "react";
import { api, type MessageDetail } from "../api";

/**
 * Email HTML is hostile input. Layers of defence:
 * 1. DOMPurify strips scripts, event handlers, forms, iframes, etc.
 * 2. Rendered in a sandboxed iframe (no scripts, no same-origin access to this app).
 * 3. The page CSP (inherited by srcdoc) blocks remote images/fonts → no tracking pixels.
 */
function buildSrcDoc(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ["form", "input", "button", "textarea", "select", "iframe", "object", "embed", "link", "meta", "base"],
    FORBID_ATTR: ["srcset"],
  });
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>body{margin:0;padding:12px;font:15px/1.5 system-ui,sans-serif;color:#111;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}</style>
</head><body>${clean}</body></html>`;
}

export function MessageView({ id }: { id: number }) {
  const [msg, setMsg] = useState<MessageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHtml, setShowHtml] = useState(true);
  const [height, setHeight] = useState(400);

  useEffect(() => {
    api.get<MessageDetail>(`/api/messages/${id}`).then(setMsg, (err) => setError((err as Error).message));
  }, [id]);

  const srcDoc = useMemo(() => (msg?.html ? buildSrcDoc(msg.html) : null), [msg]);

  if (error) return <p className="error">{error}</p>;
  if (!msg) return <p className="center muted">Loading…</p>;

  return (
    <article className="message">
      <header className="bar">
        <a href="#/inbox">← Inbox</a>
        {msg.html && (
          <button className="link" onClick={() => setShowHtml(!showHtml)}>
            {showHtml ? "Plain text" : "Formatted"}
          </button>
        )}
      </header>
      <h1>{msg.subject || "(no subject)"}</h1>
      <p className="muted small">
        From <strong>{msg.fromName || msg.fromAddress}</strong> {msg.fromName && <>&lt;{msg.fromAddress}&gt;</>}
        <br />
        {new Date(msg.date).toLocaleString()}
        {msg.hasAttachments && " · has attachments (open in iCloud Mail)"}
      </p>
      {showHtml && srcDoc ? (
        <iframe
          title="Email content"
          className="email-frame"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
          // Height can't be read across the sandbox boundary, so it's expanded manually below.
          style={{ height }}
        />
      ) : (
        <pre className="email-text">{msg.text}</pre>
      )}
      {showHtml && srcDoc && (
        <button className="more" onClick={() => setHeight((h) => h + 800)}>Show more</button>
      )}
      <p className="muted small">Remote images are blocked to prevent tracking.</p>
    </article>
  );
}
