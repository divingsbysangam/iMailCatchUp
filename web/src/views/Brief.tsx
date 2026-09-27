import { useEffect, useMemo, useState } from "react";
import { api, isoDate, parseLocalDate, type BriefDetail, type BriefItem, type BriefListItem, type Status } from "../api";
import { Icon } from "../lib/icons";
import { Orb } from "../lib/Orb";
import { useMessageLink } from "../lib/openMessage";
import type { OrbState } from "../lib/orb";

const COLLAPSE_AFTER = 4;
const COLLAPSIBLE = new Set(["newsletters", "promotions", "notifications", "fyi"]);

function dayLabel(date: string): string {
  return parseLocalDate(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
}

function slotName(time: string): string {
  if (time < "12:00") return "Morning";
  if (time < "17:00") return "Afternoon";
  return "Evening";
}

export function BriefView({ status, briefId, onChange, version }: { status: Status | null; briefId: number | null; onChange: () => void; version: number }) {
  const { linkProps, rowClick } = useMessageLink();
  const [list, setList] = useState<BriefListItem[] | null>(null);
  const [detail, setDetail] = useState<BriefDetail | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const today = status?.today ?? isoDate(new Date());
  const loadList = () => api.get<{ briefs: BriefListItem[] }>("/api/briefs").then((r) => setList(r.briefs), (e) => setError((e as Error).message));
  useEffect(() => void loadList(), []);

  // Which date is shown: the routed brief's date, else the chosen date, else today.
  const routed = list?.find((b) => b.id === briefId) ?? null;
  const shownDate = routed?.localDate ?? date ?? today;
  const briefsOfDay = useMemo(() => (list ?? []).filter((b) => b.localDate === shownDate).sort((a, b) => a.createdAt - b.createdAt), [list, shownDate]);
  const selected = routed ?? briefsOfDay[briefsOfDay.length - 1] ?? null;

  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    api.get<BriefDetail>(`/api/briefs/${selected.id}`).then(setDetail, (e) => setError((e as Error).message));
  }, [selected?.id, version]);

  // Seven-day strip ending on the shown date's week end (never past today).
  const days = useMemo(() => {
    const end = parseLocalDate(shownDate > today ? today : shownDate);
    const last = new Date(end);
    const out: string[] = [];
    for (let i = 6; i >= 0; i--) out.push(isoDate(new Date(last.getFullYear(), last.getMonth(), last.getDate() - i, 12)));
    return out;
  }, [shownDate, today]);
  const hasBrief = new Set((list ?? []).map((b) => b.localDate));

  const pick = (d: string) => {
    setDate(d);
    if (briefId) window.location.hash = "#/brief";
  };
  const shift = (delta: number) => {
    const d = parseLocalDate(days[days.length - 1]!);
    const next = isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta * 7, 12));
    pick(next > today ? today : next);
  };

  // Slot tabs: each scheduled time, plus any manual briefs that day.
  const scheduled = status?.briefTimes.map((b) => b.time) ?? [];
  const nowTime = new Date().toTimeString().slice(0, 5);
  const slotTabs = [
    ...scheduled.map((time) => {
      const b = [...briefsOfDay].reverse().find((x) => x.slot === time) ?? null;
      const state: OrbState = b ? (b.done ? "done" : "current") : "ahead";
      const note = b ? (b.done ? "Done" : "New") : shownDate === today && time > nowTime ? "Upcoming" : "None";
      return { key: time, label: slotName(time), time, brief: b, state, note };
    }),
    ...briefsOfDay
      .filter((b) => !scheduled.includes(b.slot))
      .map((b) => ({ key: `m${b.id}`, label: "On demand", time: b.slot, brief: b, state: (b.done ? "done" : "current") as OrbState, note: b.done ? "Done" : "New" })),
  ];

  const openBrief = (b: BriefListItem | null) => {
    if (b) window.location.hash = `#/brief/${b.id}`;
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.post<{ id: number }>("/api/briefs");
      await loadList();
      onChange();
      window.location.hash = `#/brief/${id}`;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleDone = async () => {
    if (!detail) return;
    await api.post(`/api/briefs/${detail.id}/done`, { done: !detail.done });
    setDetail({ ...detail, done: !detail.done });
    void loadList();
  };

  const toggleTodo = async (emailId: number) => {
    if (!detail) return;
    const cur = detail.live[emailId]?.todo ?? false;
    await api.post(`/api/messages/${emailId}/todo`, { todo: !cur });
    setDetail({ ...detail, live: { ...detail.live, [emailId]: { stored: true, todo: !cur } } });
    onChange();
  };

  const c = detail?.content;
  const byId = new Map<number, BriefItem>();
  c?.sections.forEach((s) => s.items.forEach((i) => byId.set(i.emailId, i)));
  const readSecs = c ? Math.max(30, Math.round(c.itemCount * 4 / 10) * 10) : 0;
  const needsYou = status?.counts.needsYou ?? 0;

  const row = (item: BriefItem, note?: string) => {
    const live = detail?.live[item.emailId];
    return (
      <li className={`row${live?.stored ? " link" : " read"}`} key={`${note ? "i" : "s"}${item.emailId}`} onClick={live?.stored ? rowClick(item.emailId) : undefined}>
        <div className="row-main">
          <div className="row-top">
            {live?.stored ? (
              <a className="who" {...linkProps(item.emailId)}>{item.from}</a>
            ) : (
              <span className="who">{item.from}</span>
            )}
          </div>
          {item.subject && <p className="subj">{item.subject}</p>}
          <p className="ai">{note ?? item.summary}</p>
        </div>
        <div className="row-side">
          {item.highlight && <span className="fact">{item.highlight}</span>}
          {live?.stored ? (
            <button type="button" className="mark" aria-pressed={live.todo} onClick={() => toggleTodo(item.emailId)}>
              {live.todo ? "On to-dos" : "To-do"}
            </button>
          ) : (
            <span className="coord">Read</span>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      <section className="page-head" aria-labelledby="brief-title">
        <div className="head-row">
          <p className="eyebrow">
            {selected ? `${slotName(selected.slot)} brief` : "Brief"} · {dayLabel(shownDate)}
          </p>
          <button type="button" className="btn signal" onClick={generate} disabled={busy}>
            {busy ? "Briefing…" : "Brief me now"}
          </button>
        </div>
        <h1 id="brief-title" tabIndex={-1}>
          {c ? c.headline : selected ? "Loading the brief…" : shownDate === today ? "No brief yet today." : "No brief that day."}
        </h1>
        {c?.overview && <p className="ai lede-ai">{c.overview}</p>}
        {c && (
          <p className="coord">
            {c.itemCount} item{c.itemCount === 1 ? "" : "s"} · {needsYou} need{needsYou === 1 ? "s" : ""} you · ~{readSecs} sec read
          </p>
        )}
        {error && <p className="error-line" role="alert">{error}</p>}
      </section>

      <div className="days" role="tablist" aria-label="Day">
        <button type="button" className="shift" onClick={() => shift(-1)} aria-label="Previous week">
          <Icon name="prev" />
        </button>
        {days.map((d) => {
          const dt = parseLocalDate(d);
          return (
            <button
              key={d}
              type="button"
              role="tab"
              className={`day${d === today ? " today" : ""}`}
              aria-selected={d === shownDate}
              aria-label={`${dt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}${hasBrief.has(d) ? ", has briefs" : ""}`}
              onClick={() => pick(d)}
            >
              <span className="dow">{dt.toLocaleDateString("en-GB", { weekday: "short" })}</span>
              <span className="dom">{dt.getDate()}</span>
              <span className={`has${hasBrief.has(d) ? " on" : ""}`} aria-hidden="true" />
            </button>
          );
        })}
        <button type="button" className="shift" onClick={() => shift(1)} aria-label="Next week" disabled={days[days.length - 1]! >= today}>
          <Icon name="next" />
        </button>
      </div>

      <div className="slots" role="tablist" aria-label="Brief">
        {slotTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            className="tab"
            aria-selected={!!t.brief && t.brief.id === selected?.id}
            disabled={!t.brief}
            onClick={() => openBrief(t.brief)}
          >
            <Orb state={t.state} size={22} />
            {t.label} {t.time} <span className="sub">· {t.note}</span>
          </button>
        ))}
      </div>

      {needsYou > 0 && (
        <aside className="waypoint" aria-label="Needs you">
          <p className="wp-kicker">Needs you · {needsYou}</p>
          <h3>
            {needsYou} email{needsYou === 1 ? " is" : "s are"} waiting for a reply or a decision.
          </h3>
          <a className="btn ghost" href="#/needs">
            Open needs you <Icon name="next" />
          </a>
        </aside>
      )}

      {!selected && list && (
        <p className="placeholder">
          {shownDate === today ? (
            <>
              Briefs arrive at <b>{scheduled.join(" and ")}</b>. Mail that doesn't need you collects here until then. Or use{" "}
              <b>Brief me now</b>.
            </>
          ) : (
            <>No brief was made on this day.</>
          )}
        </p>
      )}

      {c && c.important.length > 0 && (
        <section className="section" aria-labelledby="sec-important">
          <div className="section-head">
            <h2 id="sec-important">Worth a look · {c.important.length}</h2>
          </div>
          <ul className="rows">{c.important.flatMap((i) => (byId.get(i.emailId) ? [row(byId.get(i.emailId)!, i.why)] : []))}</ul>
        </section>
      )}

      {c?.sections.map((s) => {
        const collapse = COLLAPSIBLE.has(s.category) && s.items.length > COLLAPSE_AFTER;
        const head = collapse ? s.items.slice(0, 3) : s.items;
        const rest = collapse ? s.items.slice(3) : [];
        return (
          <section className="section" key={s.category} aria-labelledby={`sec-${s.category}`}>
            <div className="section-head">
              <h2 id={`sec-${s.category}`}>
                {s.label} · {s.items.length}
              </h2>
            </div>
            <ul className="rows">{head.map((i) => row(i))}</ul>
            {rest.length > 0 && (
              <details className="more">
                <summary>{rest.length} more</summary>
                <ul className="rows">{rest.map((i) => row(i))}</ul>
              </details>
            )}
          </section>
        );
      })}

      {detail && (
        <div className="foot-actions">
          <button type="button" className="btn ghost" aria-pressed={detail.done} onClick={toggleDone}>
            <Icon name="done" /> {detail.done ? "Brief done · undo" : "Mark brief done"}
          </button>
          {detail.model && (
            <span className="coord">
              Written by {detail.model}
              {detail.inputTokens != null && ` · ${detail.inputTokens.toLocaleString()} in / ${(detail.outputTokens ?? 0).toLocaleString()} out tokens`}
            </span>
          )}
        </div>
      )}
    </>
  );
}
