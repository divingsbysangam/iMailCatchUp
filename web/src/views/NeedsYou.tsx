import { useCallback, useEffect, useState } from "react";
import { api, coordTime, sender, type MessageSummary } from "../api";
import { IconButton } from "../lib/icons";
import { useMessageLink } from "../lib/openMessage";

export function MessageRow({ m, onTodo }: { m: MessageSummary; onTodo: (m: MessageSummary) => void }) {
  const { linkProps, rowClick } = useMessageLink();
  return (
    <li className="row link" onClick={rowClick(m.id)}>
      <div className="row-main">
        <div className="row-top">
          <a className="who" {...linkProps(m.id)}>{sender(m)}</a>
          {m.categoryLabel && m.category !== "needs_reply" && <span className="coord">{m.categoryLabel}</span>}
        </div>
        <p className="subj">{m.subject || "(no subject)"}</p>
        {m.summary ? <p className="ai">{m.summary}</p> : <p className="plain">{m.snippet}</p>}
        {!m.summary && <p className="coord">Not screened yet</p>}
      </div>
      <div className="row-side">
        <span className="coord">{coordTime(m.date)}</span>
        {m.highlight && <span className="fact">{m.highlight}</span>}
        <IconButton icon="mock" iconOn="bookmarkOn" pressed={m.todo} label={m.todo ? "On your to-dos (tap to remove)" : "Add to to-dos"} onClick={() => onTodo(m)} />
      </div>
    </li>
  );
}

export function NeedsYou({ onChange }: { onChange: () => void }) {
  const [view, setView] = useState<"needs" | "all">("needs");
  const [messages, setMessages] = useState<MessageSummary[] | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(
    async (before?: number) => {
      try {
        const q = `?view=${view}${before ? `&before=${before}` : ""}`;
        const { messages: page } = await api.get<{ messages: MessageSummary[] }>(`/api/messages${q}`);
        setMessages((prev) => (before && prev ? [...prev, ...page] : page));
        setDone(page.length < 50);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [view],
  );
  useEffect(() => {
    setMessages(null);
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      await api.post("/api/sync");
      await load();
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const toggleTodo = async (m: MessageSummary) => {
    await api.post(`/api/messages/${m.id}/todo`, { todo: !m.todo });
    setMessages((list) => list?.map((x) => (x.id === m.id ? { ...x, todo: !m.todo } : x)) ?? null);
    onChange();
  };

  const n = messages?.length ?? 0;
  return (
    <>
      <section className="page-head">
        <div className="head-row">
          <p className="eyebrow">{view === "needs" ? "Needs you" : "All recent"}</p>
          <IconButton icon="sync" label={syncing ? "Syncing…" : "Sync with iCloud now"} onClick={sync} disabled={syncing} />
        </div>
        <h1 tabIndex={-1}>
          {messages === null
            ? "Loading…"
            : view === "needs"
              ? n === 0
                ? "Nothing needs you."
                : `${n}${done ? "" : "+"} email${n === 1 ? " wants" : "s want"} an answer.`
              : `${n}${done ? "" : "+"} recent email${n === 1 ? "" : "s"}.`}
        </h1>
        {view === "needs" && <p className="lede">Mail from people expecting a reply or decision. Everything else waits for the brief.</p>}
        {error && <p className="error-line" role="alert">{error}</p>}
      </section>

      <div className="tabs" role="tablist" aria-label="Which mail">
        <button type="button" role="tab" className="tab" aria-selected={view === "needs"} onClick={() => setView("needs")}>
          Needs you
        </button>
        <button type="button" role="tab" className="tab" aria-selected={view === "all"} onClick={() => setView("all")}>
          All recent
        </button>
      </div>

      <ul className="rows">{messages?.map((m) => <MessageRow key={m.id} m={m} onTodo={toggleTodo} />)}</ul>
      {!done && messages && messages.length > 0 && (
        <div className="foot-actions">
          <IconButton icon="expand" label="Load more" onClick={() => load(messages[messages.length - 1]!.date)} />
        </div>
      )}
    </>
  );
}
