export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("imc:unauthorized"));
    throw new ApiError(res.status, (data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
};

export interface MessageSummary {
  id: number;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  snippet: string | null;
  summary: string | null;
  highlight: string | null;
  category: string | null;
  categoryLabel: string | null;
  action: "inbox" | "brief" | null;
  date: number;
  seen: boolean;
  hasAttachments: boolean;
  todo: boolean;
  todoDoneAt: number | null;
  archived: boolean;
}

export interface AttachmentInfo {
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

export interface MessageDetail extends MessageSummary {
  mailbox: string;
  to: { name?: string; address?: string }[];
  text: string | null;
  html: string | null;
  attachments: AttachmentInfo[];
}

export interface BriefListItem {
  id: number;
  createdAt: number;
  localDate: string;
  slot: string;
  slotLabel: string;
  itemCount: number;
  trigger: string;
  done: boolean;
  headline: string;
}

export interface BriefItem {
  emailId: number;
  from: string;
  subject: string;
  summary: string;
  highlight: string | null;
  date: number;
}

export interface BriefDetail {
  id: number;
  createdAt: number;
  localDate: string;
  slot: string;
  slotLabel: string;
  trigger: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  done: boolean;
  content: {
    headline: string;
    overview: string;
    important: { emailId: number; why: string }[];
    sections: { category: string; label: string; items: BriefItem[] }[];
    itemCount: number;
    needsYou: number;
  };
  live: Record<string, { stored: boolean; todo: boolean }>;
}

export interface Status {
  lastSyncAt: number | null;
  lastSyncError: { at: number; message: string } | null;
  briefTimes: { time: string; label: string }[];
  briefTimezone: string;
  today: string;
  mailboxes: string[];
  unreadOnly: boolean;
  autoArchive: boolean;
  markReadOnOpen: boolean;
  archiveFolder: string;
  counts: { needsYou: number; waitingForBrief: number; todos: number };
  pushDevices: number;
}

export function sender(m: { fromName: string | null; fromAddress: string | null }): string {
  return m.fromName || m.fromAddress || "Unknown sender";
}

/** Mono coordinate for a timestamp: "18:02" today, "27 SEP" otherwise. */
export function coordTime(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
}

/** "2026-09-27" → Date at local noon (safe from DST edges). */
export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
