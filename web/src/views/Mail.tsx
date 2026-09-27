import { useCallback, useContext, useEffect, useState, type FormEvent } from "react";
import { api, coordTime, sender, type FolderInfo, type LiveSummary } from "../api";
import { IconButton } from "../lib/icons";
import { OpenLiveContext } from "../lib/openMessage";

const FOLDER_KEY = "surface.mail.folder";

function savedFolder(): string {
  try {
    return localStorage.getItem(FOLDER_KEY) || "INBOX";
  } catch {
    return "INBOX";
  }
}

/** Browse any iCloud folder and search the whole mailbox, live. Read-only: nothing is stored or marked read. */
export function MailView() {
  const openLive = useContext(OpenLiveContext);
  const [folders, setFolders] = useState<FolderInfo[] | null>(null);
  const [folder, setFolder] = useState(savedFolder);
  const [items, setItems] = useState<LiveSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{ q: string; scope: "all" | "folder"; searched: number } | null>(null);
  const [scope, setScope] = useState<"all" | "folder">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = useCallback((path: string) => folders?.find((f) => f.path === path)?.name ?? (path === "INBOX" ? "Inbox" : path), [folders]);

  useEffect(() => {
    api.get<{ folders: FolderInfo[] }>("/api/mail/folders").then(
      ({ folders: list }) => {
        setFolders(list);
        if (!list.some((f) => f.path === folder)) setFolder("INBOX");
      },
      (err) => setError((err as Error).message),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFolder = useCallback(async (path: string, offset = 0) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.get<{ messages: LiveSummary[]; total: number }>(`/api/mail/list?folder=${encodeURIComponent(path)}&offset=${offset}`);
      setItems((prev) => (offset && prev ? [...prev, ...r.messages] : r.messages));
      setTotal(r.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FOLDER_KEY, folder);
    } catch {
      // per-device convenience only
    }
    if (search) return;
    setItems(null);
    void loadFolder(folder);
  }, [folder, search, loadFolder]);

  const runSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setBusy(true);
    setError(null);
    setItems(null);
    try {
      const where = scope === "folder" ? `&folder=${encodeURIComponent(folder)}` : "";
      const r = await api.get<{ messages: LiveSummary[]; searched: number }>(`/api/mail/search?q=${encodeURIComponent(q)}${where}`);
      setSearch({ q, scope, searched: r.searched });
      setItems(r.messages);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clearSearch = () => {
    setQuery("");
    setSearch(null);
  };

  const heading = search
    ? items === null
      ? "Searching…"
      : `${items.length}${items.length >= 60 ? "+" : ""} result${items.length === 1 ? "" : "s"} for “${search.q}”`
    : nameOf(folder);

  return (
    <>
      <section className="page-head">
        <div className="head-row">
          <p className="eyebrow">iCloud mail</p>
          {!search && <IconButton icon="sync" label={busy ? "Loading…" : "Reload"} onClick={() => void loadFolder(folder)} disabled={busy} />}
        </div>
        <h1 tabIndex={-1}>{heading}</h1>
        <p className="lede">
          {search
            ? search.scope === "all"
              ? `Searched ${search.searched} folder${search.searched === 1 ? "" : "s"}: sender, subject and text.`
              : `Searched ${nameOf(folder)}: sender, subject and text.`
            : "Read live from iCloud. Opening an email here doesn't mark it read."}
        </p>
        {error && <p className="error-line" role="alert">{error}</p>}
      </section>

      <form className="mail-tools" role="search" onSubmit={runSearch}>
        <div className="search-box">
          <input
            type="search"
            aria-label="Search mail"
            placeholder={scope === "all" ? "Search all of iCloud" : `Search ${nameOf(folder)}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            enterKeyHint="search"
            minLength={2}
            maxLength={100}
          />
          {search ? (
            <IconButton icon="close" label="Clear search" onClick={clearSearch} />
          ) : (
            <IconButton icon="search" label="Search" onClick={() => void runSearch()} disabled={busy || query.trim().length < 2} />
          )}
        </div>
        <div className="mail-selects">
          <label className="select">
            <span className="coord">Folder</span>
            <select value={folder} onChange={(e) => { setFolder(e.target.value); clearSearch(); }} disabled={!folders}>
              {(folders ?? [{ path: folder, name: nameOf(folder), unseen: null } as FolderInfo]).map((f) => (
                <option key={f.path} value={f.path}>
                  {f.name}{f.unseen ? ` (${f.unseen} unread)` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="select">
            <span className="coord">Search in</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as "all" | "folder")}>
              <option value="all">All folders</option>
              <option value="folder">This folder</option>
            </select>
          </label>
        </div>
      </form>

      {items !== null && items.length === 0 && !busy && <p className="coord empty-note">{search ? "Nothing found." : "This folder is empty."}</p>}
      <ul className="rows">
        {items?.map((m) => (
          <li key={`${m.folder}/${m.uid}`} className={`row link${m.seen ? " read" : ""}`} onClick={() => openLive({ folder: m.folder, uid: m.uid, folderName: nameOf(m.folder) })}>
            <div className="row-main">
              <div className="row-top">
                <a
                  className="who"
                  href="#/mail"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openLive({ folder: m.folder, uid: m.uid, folderName: nameOf(m.folder) });
                  }}
                >
                  {!m.seen && <span className="unread-dot" aria-label="Unread" />}
                  {sender(m)}
                </a>
                {search && <span className="coord">{nameOf(m.folder)}</span>}
              </div>
              <p className="subj">{m.subject || "(no subject)"}</p>
            </div>
            <div className="row-side">
              <span className="coord">{coordTime(m.date)}</span>
            </div>
          </li>
        ))}
      </ul>
      {!search && items && items.length < total && (
        <div className="foot-actions">
          <IconButton icon="expand" label={busy ? "Loading…" : "Load older"} onClick={() => void loadFolder(folder, items.length)} disabled={busy} />
          <span className="coord">{items.length} of {total}</span>
        </div>
      )}
    </>
  );
}
