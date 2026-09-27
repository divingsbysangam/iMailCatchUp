import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, sender, type MessageDetail } from "../api";
import { IconButton } from "../lib/icons";

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

/**
 * MARK_READ_ON_OPEN: once an email has been shown, closing it (any way: Close, Esc, Back, leaving the
 * page) marks it read in iCloud and removes the app's copy, unless "Keep unread" is pressed.
 */
function useMarkReadOnClose(id: number, enabled: boolean, onRead: () => void) {
  const [keepUnread, setKeepUnread] = useState(false);
  const loaded = useRef(false);
  const skip = useRef(false);
  const keep = useRef(false);
  const on = useRef(enabled);
  keep.current = keepUnread;
  on.current = enabled; // read at close time: status may arrive after the email opened
  useEffect(() => {
    loaded.current = false;
    skip.current = false;
    setKeepUnread(false);
    return () => {
      if (on.current && loaded.current && !keep.current && !skip.current) {
        void api.post(`/api/messages/${id}/read`).then(onRead, () => {});
      }
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    readMode: enabled ? { keepUnread, setKeepUnread } : undefined,
    onLoaded: () => { loaded.current = true; },
    skipOnce: () => { skip.current = true; },
  };
}

type ReadMode = { keepUnread: boolean; setKeepUnread: (v: boolean) => void };

/** The email itself: header, AI summary, actions and body. Used by the full page and the pop-up. */
export function MessageContent({ id, onChange, titleId, readMode, onLoaded }: {
  id: number;
  onChange: () => void;
  titleId?: string;
  readMode?: ReadMode;
  onLoaded?: () => void;
}) {
  const [msg, setMsg] = useState<MessageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHtml, setShowHtml] = useState(true);
  const [height, setHeight] = useState(480);

  useEffect(() => {
    setMsg(null);
    setError(null);
    api.get<MessageDetail>(`/api/messages/${id}`).then(
      (m) => {
        setMsg(m);
        onLoaded?.();
      },
      (err) => setError((err as Error).message),
    );
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
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

      <div className="msg-actions icon-row">
        <IconButton icon="mock" iconOn="bookmarkOn" pressed={msg.todo} label={msg.todo ? "On your to-dos (tap to remove)" : "Add to to-dos"} onClick={toggleTodo} />
        {readMode && (
          <IconButton icon="mail" iconOn="mailDot" pressed={readMode.keepUnread} label={readMode.keepUnread ? "Keeping unread (tap to undo)" : "Keep unread"} onClick={() => readMode.setKeepUnread(!readMode.keepUnread)} />
        )}
        {msg.html && (
          <IconButton icon="text" pressed={!showHtml} label={showHtml ? "Show plain text" : "Show formatted"} onClick={() => setShowHtml(!showHtml)} />
        )}
      </div>
      {readMode && (
        <p className="coord read-note" role="status">
          {readMode.keepUnread
            ? "Stays unread in iCloud and in this app."
            : msg.todo
              ? "Closing marks it read in iCloud. It stays here while it's on your to-dos."
              : "Closing marks it read in iCloud and removes it from this app."}
        </p>
      )}

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
            <IconButton icon="expand" label="Show more of the email" onClick={() => setHeight((h) => h + 800)} />
            <span className="coord">Remote images blocked</span>
          </div>
        </>
      ) : (
        <pre className="email-text">{msg.text}</pre>
      )}
    </article>
  );
}

/** Full-page view, for deep links (#/messages/:id) and "open in new tab". */
export function MessageView({ id, onChange, markRead, onRead }: { id: number; onChange: () => void; markRead: boolean; onRead: () => void }) {
  const { readMode, onLoaded } = useMarkReadOnClose(id, markRead, onRead);
  return (
    <>
      <p className="crumb">
        <IconButton icon="prev" className="bare" label="Back" href="#" onClick={(e) => { e.preventDefault(); history.length > 1 ? history.back() : (location.hash = "#/needs"); }} />
      </p>
      <MessageContent id={id} onChange={onChange} readMode={readMode} onLoaded={onLoaded} />
    </>
  );
}

/**
 * The pop-up. A native modal <dialog>: focus is trapped inside, Esc closes it, and the page behind
 * is inert. Field System: a plain sheet with a hairline border, no shadow, blur or rounding.
 */
export function MessageDialog({ id, onClose, onChange, markRead, onRead }: {
  id: number;
  onClose: () => void;
  onChange: () => void;
  markRead: boolean;
  onRead: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { readMode, onLoaded, skipOnce } = useMarkReadOnClose(id, markRead, onRead);
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
        <IconButton icon="external" className="bare sheet-full" label="Open as full page" href={`#/messages/${id}`} onClick={skipOnce} />
        <IconButton icon="close" className="sheet-close" label="Close" onClick={onClose} />
      </div>
      <div className="sheet-body">
        <MessageContent id={id} onChange={onChange} titleId="sheet-title" readMode={readMode} onLoaded={onLoaded} />
      </div>
    </dialog>
  );
}
