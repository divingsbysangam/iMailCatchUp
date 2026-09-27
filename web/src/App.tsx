import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Status } from "./api";
import { BriefView } from "./views/Brief";
import { Login } from "./views/Login";
import { Icon, type IconName } from "./lib/icons";
import { OpenMessageContext } from "./lib/openMessage";
import { MessageDialog, MessageView } from "./views/Message";
import { NeedsYou } from "./views/NeedsYou";
import { Settings } from "./views/Settings";
import { Todos } from "./views/Todos";

const APP_NAME = "Surface";

function useHashRoute(): string[] {
  const parse = () => (window.location.hash.replace(/^#\/?/, "") || "brief").split("/");
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

const TABS: { key: string; label: string; href: string; icon: IconName }[] = [
  { key: "brief", label: "Brief", href: "#/brief", icon: "reading" },
  { key: "needs", label: "Needs you", href: "#/needs", icon: "inbox" },
  { key: "todos", label: "To-dos", href: "#/todos", icon: "mock" },
  { key: "settings", label: "Settings", href: "#/settings", icon: "gear" },
];

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [announce, setAnnounce] = useState("");
  const route = useHashRoute();
  const viewRef = useRef<HTMLElement>(null);
  // Email pop-up. Opening pushes a history entry so the phone's Back button closes it.
  const [openId, setOpenId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const pushed = useRef(false);
  const changed = useRef(false);

  const openMessage = useCallback((id: number) => {
    if (!pushed.current) {
      history.pushState({ imcSheet: true }, "", window.location.href);
      pushed.current = true;
    }
    setOpenId(id);
  }, []);
  const finishClose = useCallback(() => {
    setOpenId(null);
    if (changed.current) {
      changed.current = false;
      setVersion((v) => v + 1); // let the page behind reload (to-do marks etc.)
    }
  }, []);
  const closeMessage = useCallback(() => {
    if (pushed.current) history.back(); // popstate below finishes the close
    else finishClose();
  }, [finishClose]);
  useEffect(() => {
    const onPop = () => {
      if (pushed.current) {
        pushed.current = false;
        finishClose();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [finishClose]);
  // A route change (e.g. "Open full page") drops the pop-up.
  useEffect(() => {
    if (!window.location.hash.startsWith("#/messages/")) return;
    pushed.current = false;
    setOpenId(null);
  }, [route.join("/")]);

  const refreshStatus = useCallback(() => api.get<Status>("/api/status").then(setStatus, () => {}), []);

  useEffect(() => {
    api.get("/api/auth/me").then(() => setAuthed(true), () => setAuthed(false));
    const onUnauthorized = () => setAuthed(false);
    window.addEventListener("imc:unauthorized", onUnauthorized);
    return () => window.removeEventListener("imc:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    if (authed) void refreshStatus();
  }, [authed, route.join("/"), refreshStatus]);

  const [section, id] = route;
  const tab = section === "messages" ? "needs" : section === "brief" || !section ? "brief" : section;
  const title = TABS.find((t) => t.key === tab)?.label ?? "Message";

  // Per-route document title + live-region announcement; focus moves to the view on route change.
  useEffect(() => {
    if (!authed) return;
    document.title = `${title} · ${APP_NAME}`;
    setAnnounce(`${title} page`);
    viewRef.current?.focus({ preventScroll: true });
  }, [authed, route.join("/"), title]);

  if (authed === null) return <main className="wrap"><p className="coord page-head">Loading…</p></main>;

  const chrome = (content: React.ReactNode) => (
    <>
      <a className="skip-link" href="#view">Skip to content</a>
      <header className="site-nav">
        <a className="brand" href="#/brief" aria-label={`${APP_NAME} by Divings, go to the brief`}>
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-word">{APP_NAME}</span>
        </a>
        {authed && (
          <nav className="nav-links" aria-label="Main">
            {TABS.map((t) => (
              <a key={t.key} href={t.href} aria-current={tab === t.key ? "page" : undefined}>
                {t.label}
                {t.key === "needs" && status?.counts.needsYou ? <span className="nav-count">{status.counts.needsYou}</span> : null}
                {t.key === "todos" && status?.counts.todos ? <span className="nav-count">{status.counts.todos}</span> : null}
              </a>
            ))}
          </nav>
        )}
      </header>
      <main id="view" className="wrap" tabIndex={-1} ref={viewRef}>
        {content}
      </main>
      <footer className="site-foot">
        <div className="foot-main">
          <p className="foot-kicker">{APP_NAME} · by Divings</p>
          <p className="foot-line">
            {status?.lastSyncAt
              ? `Synced ${new Date(status.lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}. ${status.counts.needsYou} need${status.counts.needsYou === 1 ? "s" : ""} you, ${status.counts.waitingForBrief} wait${status.counts.waitingForBrief === 1 ? "s" : ""} for the next brief.`
              : "Mail you haven't read, in the order it matters."}
          </p>
          {status && (
            <p className="foot-meta">
              Briefs at {status.briefTimes.map((b) => b.time).join(" and ")} ({status.briefTimezone}).
            </p>
          )}
        </div>
        <div className="foot-fine">
          <p className="foot-disclaimer">
            <strong>Summaries and sorting are written by AI and can be wrong.</strong> Check the original email before you act on
            it. Unread mail is copied from iCloud, stored encrypted and kept for up to 14 days; excerpts are sent to OpenAI to
            write briefs.
          </p>
        </div>
      </footer>
      {authed && (
        <nav className="tabbar" aria-label="Main (phone)">
          {TABS.map((t) => {
            const count = t.key === "needs" ? status?.counts.needsYou : t.key === "todos" ? status?.counts.todos : 0;
            return (
              <a key={t.key} href={t.href} aria-current={tab === t.key ? "page" : undefined} aria-label={count ? `${t.label}, ${count}` : t.label} title={t.label}>
                <Icon name={t.icon} />
                {count ? <span className="tab-count" aria-hidden="true">{count}</span> : null}
              </a>
            );
          })}
        </nav>
      )}
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
    </>
  );

  if (!authed) return chrome(<Login onSuccess={() => setAuthed(true)} />);

  const onChange = () => {
    changed.current = true;
    void refreshStatus();
  };

  let view;
  const onRead = () => {
    setVersion((v) => v + 1);
    void refreshStatus();
  };
  const markRead = status?.markReadOnOpen ?? false;
  if (section === "messages" && id) view = <MessageView id={Number(id)} onChange={refreshStatus} markRead={markRead} onRead={onRead} />;
  else if (section === "needs") view = <NeedsYou key={version} onChange={refreshStatus} />;
  else if (section === "todos") view = <Todos key={version} onChange={refreshStatus} />;
  else if (section === "settings") view = <Settings status={status} onSignedOut={() => setAuthed(false)} onChange={refreshStatus} />;
  else view = <BriefView status={status} briefId={section === "brief" && id ? Number(id) : null} onChange={refreshStatus} version={version} />;
  return (
    <OpenMessageContext.Provider value={openMessage}>
      {chrome(view)}
      {openId !== null && <MessageDialog id={openId} onClose={closeMessage} onChange={onChange} markRead={markRead} onRead={onRead} />}
    </OpenMessageContext.Provider>
  );
}
