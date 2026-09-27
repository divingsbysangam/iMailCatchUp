import { useEffect, useState } from "react";
import { api, coordTime, sender, type MessageSummary } from "../api";
import { IconButton } from "../lib/icons";
import { useMessageLink } from "../lib/openMessage";

export function Todos({ onChange }: { onChange: () => void }) {
  const [todos, setTodos] = useState<MessageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { linkProps, rowClick } = useMessageLink();

  const load = () => api.get<{ todos: MessageSummary[] }>("/api/todos").then((r) => setTodos(r.todos), (e) => setError((e as Error).message));
  useEffect(() => void load(), []);

  const setDone = async (m: MessageSummary, done: boolean) => {
    await api.post(`/api/messages/${m.id}/todo-done`, { done });
    setTodos((list) => list?.map((x) => (x.id === m.id ? { ...x, todoDoneAt: done ? Date.now() : null } : x)) ?? null);
    onChange();
  };
  const remove = async (m: MessageSummary) => {
    await api.post(`/api/messages/${m.id}/todo`, { todo: false });
    setTodos((list) => list?.filter((x) => x.id !== m.id) ?? null);
    onChange();
  };

  const open = todos?.filter((t) => !t.todoDoneAt).length ?? 0;
  return (
    <>
      <section className="page-head">
        <p className="eyebrow">To-dos</p>
        <h1 tabIndex={-1}>{todos === null ? "Loading…" : open === 0 ? "Nothing on your list." : `${open} thing${open === 1 ? "" : "s"} to do.`}</h1>
        <p className="lede">Mark any email as a to-do from the brief or Needs you. It stays here until you tick it off, even after you read it elsewhere.</p>
        {error && <p className="error-line" role="alert">{error}</p>}
      </section>
      <ul className="rows">
        {todos?.map((m) => {
          const isDone = !!m.todoDoneAt;
          return (
            <li key={m.id} className={`row link${isDone ? " done" : ""}`} onClick={rowClick(m.id)}>
              <IconButton icon="done" pressed={isDone} label={isDone ? `Mark "${m.subject}" not done` : `Mark "${m.subject}" done`} onClick={() => setDone(m, !isDone)} />
              <div className="row-main">
                <div className="row-top">
                  <a className="who" {...linkProps(m.id)}>{sender(m)}</a>
                  {isDone && <span className="coord">Done</span>}
                </div>
                <p className="subj">{m.subject || "(no subject)"}</p>
                {m.summary && <p className="ai">{m.summary}</p>}
              </div>
              <div className="row-side">
                <span className="coord">{coordTime(m.date)}</span>
                {m.highlight && <span className="fact">{m.highlight}</span>}
                <IconButton icon="close" className="bare" label={`Remove "${m.subject}" from to-dos`} onClick={() => remove(m)} />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
