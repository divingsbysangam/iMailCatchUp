import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE messages (
    id               INTEGER PRIMARY KEY,
    mailbox          TEXT    NOT NULL,
    uid_validity     TEXT    NOT NULL,
    uid              INTEGER NOT NULL,
    message_id       TEXT,
    from_name        TEXT,
    from_address     TEXT,
    to_json          TEXT    NOT NULL DEFAULT '[]',
    subject_enc      TEXT,
    snippet_enc      TEXT,
    text_enc         TEXT,
    html_enc         TEXT,
    date             INTEGER NOT NULL,
    seen             INTEGER NOT NULL DEFAULT 0,
    flagged          INTEGER NOT NULL DEFAULT 0,
    has_attachments  INTEGER NOT NULL DEFAULT 0,
    size             INTEGER,
    synced_at        INTEGER NOT NULL,
    UNIQUE (mailbox, uid_validity, uid)
  );
  CREATE INDEX messages_date ON messages (date DESC);

  CREATE TABLE briefs (
    id             INTEGER PRIMARY KEY,
    created_at     INTEGER NOT NULL,
    period_start   INTEGER NOT NULL,
    period_end     INTEGER NOT NULL,
    message_count  INTEGER NOT NULL,
    model          TEXT,
    trigger        TEXT    NOT NULL,
    content_enc    TEXT    NOT NULL
  );

  CREATE TABLE push_subscriptions (
    id          INTEGER PRIMARY KEY,
    endpoint    TEXT    NOT NULL UNIQUE,
    p256dh      TEXT    NOT NULL,
    auth        TEXT    NOT NULL,
    user_agent  TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash  TEXT    PRIMARY KEY,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    user_agent  TEXT
  );

  CREATE TABLE kv (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE messages ADD COLUMN is_bulk INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE briefs ADD COLUMN input_tokens INTEGER;
  ALTER TABLE briefs ADD COLUMN output_tokens INTEGER;
  `,
  `
  -- Screener (triage) results, archiving and to-dos.
  ALTER TABLE messages ADD COLUMN category TEXT;
  ALTER TABLE messages ADD COLUMN action TEXT;           -- 'inbox' | 'brief'
  ALTER TABLE messages ADD COLUMN summary_enc TEXT;
  ALTER TABLE messages ADD COLUMN highlight_enc TEXT;
  ALTER TABLE messages ADD COLUMN triaged_at INTEGER;
  ALTER TABLE messages ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE messages ADD COLUMN brief_id INTEGER;
  ALTER TABLE messages ADD COLUMN todo INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE messages ADD COLUMN todo_done_at INTEGER;
  CREATE INDEX messages_triage ON messages (triaged_at, action, brief_id);
  -- Brief slots (e.g. morning/evening) and "done" state.
  ALTER TABLE briefs ADD COLUMN local_date TEXT;
  ALTER TABLE briefs ADD COLUMN slot TEXT;
  ALTER TABLE briefs ADD COLUMN done_at INTEGER;
  `,
];

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  const version = db.pragma("user_version", { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}

export function kvGet(db: DB, key: string): string | null {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function kvSet(db: DB, key: string, value: string): void {
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  );
}
