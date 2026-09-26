import { useCallback, useEffect, useState } from "react";
import { api, formatDate, type MessageSummary } from "../api";

export function Inbox() {
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async (before?: number) => {
    setLoading(true);
    try {
      const q = before ? `?before=${before}` : "";
      const { messages: page } = await api.get<{ messages: MessageSummary[] }>(`/api/messages${q}`);
      setMessages((prev) => (before ? [...prev, ...page] : page));
      setDone(page.length < 50);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      await api.post("/api/sync");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section>
      <header className="bar">
        <h1>Inbox</h1>
        <button onClick={sync} disabled={syncing}>{syncing ? "Syncing…" : "Refresh"}</button>
      </header>
      {error && <p className="error">{error}</p>}
      <ul className="list">
        {messages.map((m) => (
          <li key={m.id} className={m.seen ? "" : "unread"}>
            <a href={`#/messages/${m.id}`}>
              <div className="row">
                <span className="from">{m.fromName || m.fromAddress || "Unknown"}</span>
                <span className="muted small">{formatDate(m.date)}</span>
              </div>
              <div className="subject">
                {m.flagged && <span aria-label="flagged">⚑ </span>}
                {m.subject || "(no subject)"}
                {m.hasAttachments && <span className="muted"> 📎</span>}
              </div>
              <div className="snippet muted">{m.snippet}</div>
            </a>
          </li>
        ))}
      </ul>
      {!loading && messages.length === 0 && <p className="center muted">No messages synced yet. Tap Refresh.</p>}
      {!done && messages.length > 0 && (
        <button className="more" disabled={loading} onClick={() => load(messages[messages.length - 1]!.date)}>
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
