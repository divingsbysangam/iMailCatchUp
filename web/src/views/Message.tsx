import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
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

/** The email itself: header, AI summary, actions and body. Used by the full page and the pop-up. */
export function MessageContent({ id, onChange, titleId }: { id: number; onChange: () => void; titleId?: string }) {
  const [msg, setMsg] = useState<MessageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHtml, setShowHtml] = useState(true);
  const [height, setHeight] = useState(480);

  useEffect(() => {
    setMsg(null);
    setError(null);
    api.get<MessageDetail>(`/api/messages/${id}`).then(setMsg, (err) => setError((err as Error).message));
  }, [id]);
  const srcDoc = useMemo(() => (msg?.html ? buildSrcDoc(msg.html) : null), [msg]);

  const toggleTodo = async () => {
    if (!msg) return;
    await api.post(`/api/messages/${msg.id}/todo`, { todo: !msg.todo });
    setMsg({ ...msg, todo: !msg.todo });
    onChange();
  };

  if (error)
    return (
      <p className="error-line" role="alert">
        {error === "Not found" ? "This email is no longer stored here (it was read elsewhere or is older than the sync window)." : error}
      </p>
    );
  if (!msg) return <p className="coord msg-loading">Loading…</p>;

  return (
    <article>
      <header className="msg-head">
        <p className="eyebrow">{msg.categoryLabel ?? "Email"}{msg.archived ? " · Archived in iCloud" : ""}</p>
        <h1 id={titleId} tabIndex={-1}>{msg.subject || "(no subject)"}</h1>
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

/** Full-page view, for deep links (#/messages/:id) and "open in new tab". */
export function MessageView({ id, onChange }: { id: number; onChange: () => void }) {
  return (
    <>
      <p className="crumb">
        <a className="textlink" href="#" onClick={(e) => { e.preventDefault(); history.length > 1 ? history.back() : (location.hash = "#/needs"); }}>
          <Icon name="prev" className="ico" /> Back
        </a>
      </p>
      <MessageContent id={id} onChange={onChange} />
    </>
  );
}

/**
 * The pop-up. A native modal <dialog>: focus is trapped inside, Esc closes it, and the page behind
 * is inert. Field System: a plain sheet with a hairline border, no shadow, blur or rounding.
 */
export function MessageDialog({ id, onClose, onChange }: { id: number; onClose: () => void; onChange: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    opener.current = document.activeElement;
    if (!d.open) d.showModal();
    document.documentElement.classList.add("modal-open");
    d.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    return () => {
      document.documentElement.classList.remove("modal-open");
      (opener.current as HTMLElement | null)?.focus?.({ preventScroll: true }); // focus is never lost
    };
  }, []);

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [id]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }} // click on the backdrop
    >
      <div className="sheet-bar">
        <span className="coord">Email</span>
        <a className="textlink" href={`#/messages/${id}`}>
          Open full page <Icon name="external" className="ico" />
        </a>
        <button type="button" className="btn ghost sheet-close" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="sheet-body">
        <MessageContent id={id} onChange={onChange} titleId="sheet-title" />
      </div>
    </dialog>
  );
}
