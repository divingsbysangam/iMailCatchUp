import { useEffect, useRef, useState } from "react";
import { api, sender, type AttachmentInfo, type LiveMessage, type LiveRef, type MessageDetail } from "../api";
import { EmailFrame } from "../lib/emailFrame";
import { Icon, IconButton } from "../lib/icons";

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Attachments are fetched from iCloud when tapped; nothing is stored in the app. */
function Attachments({ files, urlFor }: { files: AttachmentInfo[]; urlFor: (index: number) => string }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!files.length) return null;

  const download = async (f: AttachmentInfo) => {
    setBusy(f.index);
    setError(null);
    try {
      const res = await fetch(urlFor(f.index), { credentials: "same-origin" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: f.filename });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(`Couldn't download ${f.filename}: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="attachments" aria-label="Attachments">
      <p className="eyebrow">
        {files.length} attachment{files.length === 1 ? "" : "s"}
      </p>
      <ul>
        {files.map((f) => (
          <li key={f.index}>
            <button type="button" className="att" onClick={() => void download(f)} disabled={busy !== null} aria-busy={busy === f.index}>
              <Icon name="clip" />
              <span className="att-name">{f.filename}</span>
              <span className="coord">{busy === f.index ? "Downloading…" : fileSize(f.size)}</span>
              <Icon name="download" label="Download" />
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="error-line" role="alert">{error}</p>}
    </section>
  );
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
        <p className="coord">From {sender(msg)}{msg.fromName && msg.fromAddress ? ` <${msg.fromAddress}>` : ""}</p>
        <p className="coord">
          {new Date(msg.date).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
          {msg.attachments.length ? ` · ${msg.attachments.length} attachment${msg.attachments.length === 1 ? "" : "s"}` : ""}
        </p>
      </header>

      {msg.summary && (
        <aside className="waypoint msg-waypoint" aria-label="AI summary">
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
        {readMode && (
          <p className="coord read-note" role="status">
            {readMode.keepUnread
              ? "Stays unread in iCloud and in this app."
              : msg.todo
                ? "Closing marks it read in iCloud. It stays here while it's on your to-dos."
                : "Closing marks it read in iCloud and removes it from this app."}
          </p>
        )}
      </div>

      <div className="msg-body">
        {showHtml && msg.html ? <EmailFrame html={msg.html} /> : <pre className="email-text">{msg.text}</pre>}
      </div>
      <Attachments files={msg.attachments} urlFor={(i) => `/api/messages/${msg.id}/attachments/${i}`} />
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
function Sheet({ label, resetKey, onClose, full, children }: {
  label: string;
  resetKey: string;
  onClose: () => void;
  full?: { href: string; onClick: () => void };
  children: React.ReactNode;
}) {
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
  }, [resetKey]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }} // click on the backdrop
    >
      <div className="sheet-bar">
        <span className="coord">{label}</span>
        {full && <IconButton icon="external" className="bare sheet-full" label="Open as full page" href={full.href} onClick={full.onClick} />}
        <IconButton icon="close" className="sheet-close" label="Close" onClick={onClose} />
      </div>
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}

export function MessageDialog({ id, onClose, onChange, markRead, onRead }: {
  id: number;
  onClose: () => void;
  onChange: () => void;
  markRead: boolean;
  onRead: () => void;
}) {
  const { readMode, onLoaded, skipOnce } = useMarkReadOnClose(id, markRead, onRead);
  return (
    <Sheet label="Email" resetKey={String(id)} onClose={onClose} full={{ href: `#/messages/${id}`, onClick: skipOnce }}>
      <MessageContent id={id} onChange={onChange} titleId="sheet-title" readMode={readMode} onLoaded={onLoaded} />
    </Sheet>
  );
}

/** An email opened live from any iCloud folder: read-only, not stored, not marked read. */
function LiveMessageContent({ at }: { at: LiveRef }) {
  const [msg, setMsg] = useState<LiveMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHtml, setShowHtml] = useState(true);
  const q = `folder=${encodeURIComponent(at.folder)}&uid=${at.uid}`;

  useEffect(() => {
    setMsg(null);
    setError(null);
    api.get<LiveMessage>(`/api/mail/message?${q}`).then(setMsg, (err) => setError((err as Error).message));
  }, [q]);

  if (error) return <p className="error-line" role="alert">{error}</p>;
  if (!msg) return <p className="coord msg-loading">Opening from iCloud…</p>;
  return (
    <article>
      <header className="msg-head">
        <p className="eyebrow">{at.folderName ?? at.folder}</p>
        <h1 id="sheet-title" tabIndex={-1}>{msg.subject || "(no subject)"}</h1>
        <p className="coord">From {sender(msg)}{msg.fromName && msg.fromAddress ? ` <${msg.fromAddress}>` : ""}</p>
        <p className="coord">
          {new Date(msg.date).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
          {msg.attachments.length ? ` · ${msg.attachments.length} attachment${msg.attachments.length === 1 ? "" : "s"}` : ""}
        </p>
      </header>
      <div className="msg-actions icon-row">
        {msg.html && (
          <IconButton icon="text" pressed={!showHtml} label={showHtml ? "Show plain text" : "Show formatted"} onClick={() => setShowHtml(!showHtml)} />
        )}
        <p className="coord read-note">Opened from iCloud. Not stored here or marked read.</p>
      </div>
      <div className="msg-body">
        {showHtml && msg.html ? <EmailFrame html={msg.html} /> : <pre className="email-text">{msg.text}</pre>}
      </div>
      <Attachments files={msg.attachments} urlFor={(i) => `/api/mail/attachment?${q}&index=${i}`} />
    </article>
  );
}

export function LiveMessageDialog({ at, onClose }: { at: LiveRef; onClose: () => void }) {
  return (
    <Sheet label="Email · iCloud" resetKey={`${at.folder}/${at.uid}`} onClose={onClose}>
      <LiveMessageContent at={at} />
    </Sheet>
  );
}
