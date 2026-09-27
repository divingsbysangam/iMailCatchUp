import DOMPurify from "dompurify";
import { useEffect, useMemo, useState } from "react";
import { api, sender, type MessageDetail } from "../api";
import { Icon } from "../lib/icons";

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
<style>body{margin:0;padding:16px;font:16px/1.6 system-ui,sans-serif;color:#141413;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}</style>
</head><body>${clean}</body></html>`;
}

export function MessageView({ id, onChange }: { id: number; onChange: () => void }) {
  const [msg, setMsg] = useState<MessageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHtml, setShowHtml] = useState(true);
  const [height, setHeight] = useState(480);

  useEffect(() => {
    api.get<MessageDetail>(`/api/messages/${id}`).then(setMsg, (err) => setError((err as Error).message));
  }, [id]);
  const srcDoc = useMemo(() => (msg?.html ? buildSrcDoc(msg.html) : null), [msg]);

  const toggleTodo = async () => {
    if (!msg) return;
    await api.post(`/api/messages/${msg.id}/todo`, { todo: !msg.todo });
    setMsg({ ...msg, todo: !msg.todo });
    onChange();
  };

  const back = (
    <p className="crumb">
      <a className="textlink" href="#" onClick={(e) => { e.preventDefault(); history.length > 1 ? history.back() : (location.hash = "#/needs"); }}>
        <Icon name="prev" className="ico" /> Back
      </a>
    </p>
  );
  if (error) return <>{back}<p className="error-line" role="alert">{error === "Not found" ? "This email is no longer stored here (it was read elsewhere or is older than the sync window)." : error}</p></>;
  if (!msg) return <>{back}<p className="coord page-head">Loading…</p></>;

  return (
    <article>
      {back}
      <header className="msg-head">
        <p className="eyebrow">{msg.categoryLabel ?? "Email"}{msg.archived ? " · Archived in iCloud" : ""}</p>
        <h1 tabIndex={-1}>{msg.subject || "(no subject)"}</h1>
        <p className="coord">
          From {sender(msg)}{msg.fromName && msg.fromAddress ? ` <${msg.fromAddress}>` : ""} · {new Date(msg.date).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
          {msg.hasAttachments ? " · Has attachments (open in iCloud Mail)" : ""}
        </p>
      </header>

      {msg.summary && (
        <aside className="waypoint" aria-label="AI summary">
          <p className="wp-kicker">Summary · written by AI{msg.highlight ? ` · ${msg.highlight}` : ""}</p>
          <p className="ai">{msg.summary}</p>
        </aside>
      )}

      <div className="msg-actions">
        <button type="button" className="mark" aria-pressed={msg.todo} onClick={toggleTodo}>
          {msg.todo ? "On to-dos" : "Add to to-dos"}
        </button>
        {msg.html && (
          <button type="button" className="textlink" onClick={() => setShowHtml(!showHtml)}>
            {showHtml ? "Show plain text" : "Show formatted"}
          </button>
        )}
        <span className="coord">Remote images blocked</span>
      </div>

      {showHtml && srcDoc ? (
        <>
          <iframe
            title="Email content"
            className="email-frame"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
            style={{ height }}
          />
          <div className="foot-actions">
            <button type="button" className="btn ghost" onClick={() => setHeight((h) => h + 800)}>
              <Icon name="expand" /> Show more
            </button>
          </div>
        </>
      ) : (
        <pre className="email-text">{msg.text}</pre>
      )}
    </article>
  );
}
