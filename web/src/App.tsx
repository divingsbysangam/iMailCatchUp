import { useEffect, useState } from "react";
import { api } from "./api";
import { BriefList, BriefView } from "./views/Briefs";
import { Inbox } from "./views/Inbox";
import { Login } from "./views/Login";
import { MessageView } from "./views/Message";
import { Settings } from "./views/Settings";

function useHashRoute(): string[] {
  const parse = () => (window.location.hash.replace(/^#\/?/, "") || "inbox").split("/");
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const route = useHashRoute();

  useEffect(() => {
    api.get("/api/auth/me").then(() => setAuthed(true), () => setAuthed(false));
    const onUnauthorized = () => setAuthed(false);
    window.addEventListener("imc:unauthorized", onUnauthorized);
    return () => window.removeEventListener("imc:unauthorized", onUnauthorized);
  }, []);

  if (authed === null) return <div className="center muted">Loading…</div>;
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  const [section, id] = route;
  let view;
  if (section === "messages" && id) view = <MessageView id={Number(id)} />;
  else if (section === "briefs" && id) view = <BriefView id={Number(id)} />;
  else if (section === "briefs") view = <BriefList />;
  else if (section === "settings") view = <Settings onSignedOut={() => setAuthed(false)} />;
  else view = <Inbox />;

  const tab = section === "messages" ? "inbox" : section;
  return (
    <div className="app">
      <main>{view}</main>
      <nav className="tabs">
        <a href="#/inbox" className={tab === "inbox" ? "active" : ""}>Inbox</a>
        <a href="#/briefs" className={tab === "briefs" ? "active" : ""}>Briefs</a>
        <a href="#/settings" className={tab === "settings" ? "active" : ""}>Settings</a>
      </nav>
    </div>
  );
}
