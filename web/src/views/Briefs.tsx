import { useEffect, useState } from "react";
import { api, formatDate, type BriefDetail, type BriefSummary } from "../api";

export function BriefList() {
  const [briefs, setBriefs] = useState<BriefSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get<{ briefs: BriefSummary[] }>("/api/briefs").then((r) => setBriefs(r.briefs), (e) => setError((e as Error).message));
  useEffect(() => void load(), []);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.post<{ id: number }>("/api/briefs");
      window.location.hash = `#/briefs/${id}`;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <header className="bar">
        <h1>Briefs</h1>
        <button onClick={generate} disabled={busy}>{busy ? "Generating…" : "Brief me now"}</button>
      </header>
      {error && <p className="error">{error}</p>}
      <ul className="list">
        {briefs?.map((b) => (
          <li key={b.id}>
            <a href={`#/briefs/${b.id}`}>
              <div className="row">
                <span className="from">{new Date(b.createdAt).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</span>
                <span className="muted small">{formatDate(b.createdAt)} · {b.messageCount} emails</span>
              </div>
              <div className="snippet">{b.headline}</div>
            </a>
          </li>
        ))}
      </ul>
      {briefs?.length === 0 && <p className="center muted">No briefs yet. The first one arrives this evening.</p>}
    </section>
  );
}

export function BriefView({ id }: { id: number }) {
  const [brief, setBrief] = useState<BriefDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<BriefDetail>(`/api/briefs/${id}`).then(setBrief, (e) => setError((e as Error).message));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!brief) return <p className="center muted">Loading…</p>;
  const { content, emails } = brief;

  const emailLabel = (emailId: number) => {
    const e = emails[emailId];
    return e ? `${e.fromName || e.fromAddress} — ${e.subject || "(no subject)"}` : `Email #${emailId} (no longer stored)`;
  };

  return (
    <article className="brief">
      <header className="bar">
        <a href="#/briefs">← Briefs</a>
        <span className="muted small">{new Date(brief.createdAt).toLocaleString()}</span>
      </header>
      <h1>{content.headline}</h1>
      {content.summary && <p>{content.summary}</p>}

      {content.actionItems.length > 0 && (
        <>
          <h2>To do</h2>
          <ul className="actions">
            {content.actionItems.map((a, i) => (
              <li key={i}>
                {a.task}
                {a.due && <span className="muted"> · {a.due}</span>}
                {a.emailId && emails[a.emailId] && <> · <a href={`#/messages/${a.emailId}`}>open</a></>}
              </li>
            ))}
          </ul>
        </>
      )}

      {content.highlights.length > 0 && (
        <>
          <h2>Highlights</h2>
          <ul className="list">
            {content.highlights.map((h) => (
              <li key={h.emailId}>
                <a href={emails[h.emailId] ? `#/messages/${h.emailId}` : undefined}>
                  <div className="row">
                    <span className={`pill ${h.priority}`}>{h.priority}</span>
                  </div>
                  <div className="subject">{emailLabel(h.emailId)}</div>
                  <div className="snippet">{h.why}</div>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">
        {brief.messageCount} emails summarised{brief.model ? ` by ${brief.model}` : ""}
        {brief.inputTokens != null && ` (${brief.inputTokens.toLocaleString()} in / ${(brief.outputTokens ?? 0).toLocaleString()} out tokens)`}. AI summaries can be wrong — check the original email before acting.
      </p>
    </article>
  );
}
