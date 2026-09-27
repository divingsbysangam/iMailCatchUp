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
  mailbox: string;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  snippet: string | null;
  date: number;
  seen: boolean;
  flagged: boolean;
  hasAttachments: boolean;
}

export interface MessageDetail extends MessageSummary {
  to: { name?: string; address?: string }[];
  text: string | null;
  html: string | null;
}

export interface BriefSummary {
  id: number;
  createdAt: number;
  messageCount: number;
  trigger: string;
  headline: string;
}

export interface BriefDetail {
  id: number;
  createdAt: number;
  periodStart: number;
  periodEnd: number;
  messageCount: number;
  model: string | null;
  trigger: string;
  inputTokens: number | null;
  outputTokens: number | null;
  content: {
    headline: string;
    summary: string;
    highlights: { emailId: number; priority: "high" | "medium" | "low"; why: string }[];
    actionItems: { task: string; emailId?: number | null; due?: string | null }[];
    newsletters: { emailId: number; summary: string }[];
  };
  emails: Record<string, { fromName: string | null; fromAddress: string | null; subject: string | null }>;
}

export interface Status {
  lastSyncAt: number | null;
  lastSyncError: { at: number; message: string } | null;
  briefTime: string;
  briefTimezone: string;
  mailboxes: string[];
  pushDevices: number;
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}
