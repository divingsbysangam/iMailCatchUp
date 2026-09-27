import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  /** Exact origin the PWA is served from, e.g. https://mail.example.com. Used for CSRF checks. */
  PUBLIC_ORIGIN: z.url().transform((u) => new URL(u).origin),
  DATABASE_PATH: z.string().default("./data/app.db"),

  ICLOUD_EMAIL: z.email(),
  ICLOUD_APP_PASSWORD: z.string().min(1),
  IMAP_HOST: z.string().default("imap.mail.me.com"),
  IMAP_PORT: z.coerce.number().int().positive().default(993),
  MAILBOXES: z
    .string()
    .default("INBOX")
    .transform((s) => s.split(",").map((m) => m.trim()).filter(Boolean)),
  SYNC_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(2).max(240).default(10),
  /**
   * true = only unread mail is synced; once you read a message elsewhere (e.g. iCloud Mail on a Mac),
   * it is removed from this app on the next sync. false = all mail in the sync window.
   */
  SYNC_UNREAD_ONLY: bool.default(true),
  /**
   * Cora-style archiving: mail the screener puts in the brief is marked read and moved out of the
   * inbox to ARCHIVE_FOLDER in iCloud. Needs write access to the mailbox; off by default.
   */
  AUTO_ARCHIVE: bool.default(false),
  /**
   * When you close an email in the app, mark it read in iCloud and remove the app's copy (open to-dos
   * are kept). Needs write access to the mailbox; off by default.
   */
  MARK_READ_ON_OPEN: bool.default(false),
  ARCHIVE_FOLDER: z.string().min(1).max(100).default("iMailCatchUp Brief"),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  /** Comma-separated local times for briefs, e.g. "08:30,18:00". */
  BRIEF_TIMES: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((t) => t.trim()).filter(Boolean) : undefined))
    .refine((l) => !l || (l.length > 0 && l.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))), "HH:MM[,HH:MM…], 24h"),
  /** Single brief time. Used only when BRIEF_TIMES is not set (kept for older configs). */
  BRIEF_TIME: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 24h").default("19:00"),
  BRIEF_TIMEZONE: z
    .string()
    .default("UTC")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "must be an IANA time zone, e.g. Asia/Kolkata"),
  BRIEF_MAX_EMAILS: z.coerce.number().int().min(1).max(300).default(80),
  /** Max characters of each (trimmed) email body sent to the AI. Newsletters send none. */
  BRIEF_BODY_CHARS: z.coerce.number().int().min(100).max(4000).default(800),
  /** Same, for newsletters/notifications (after removing their boilerplate). 0 = sender + subject only. */
  BRIEF_BULK_CHARS: z.coerce.number().int().min(0).max(4000).default(800),
  /** When false, the notification only says a brief is ready (nothing about content on the lock screen). */
  BRIEF_PUSH_PREVIEW: bool.default(true),

  /** Output of `npm run setup`. */
  APP_PASSWORD_HASH: z.string().startsWith("scrypt:"),
  TOTP_SECRET: z.string().regex(/^[A-Z2-7]{32,}$/, "base32, from `npm run setup`"),
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((k) => Buffer.from(k, "base64").length === 32, "must be 32 bytes, base64"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 14),

  /**
   * Header holding the client IP, set by your hosting proxy (Railway: X-Real-IP). Empty = use the TCP
   * peer address (only when the app is exposed directly, without a proxy).
   */
  CLIENT_IP_HEADER: z
    .string()
    .default("x-real-ip")
    .transform((h) => h.trim().toLowerCase()),
  /**
   * Shared secret that a Cloudflare Transform Rule adds as the X-Origin-Auth request header.
   * When it matches, CF-Connecting-IP is trusted as the client IP.
   */
  CLOUDFLARE_ORIGIN_SECRET: z.string().min(32, "at least 32 chars; `openssl rand -hex 32`").optional(),
  /** Reject every request that didn't come through Cloudflare (except /healthz). Needs CLOUDFLARE_ORIGIN_SECRET. */
  REQUIRE_CLOUDFLARE: bool.default(false),

  VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/, "mailto: or https:// URL"),
});

export type Config = z.infer<typeof schema> & { briefTimes: string[] };

const checked = schema.refine((c) => !c.REQUIRE_CLOUDFLARE || c.CLOUDFLARE_ORIGIN_SECRET, {
  path: ["REQUIRE_CLOUDFLARE"],
  message: "needs CLOUDFLARE_ORIGIN_SECRET to be set",
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = checked.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${issues.join("\n")}`);
  }
  const briefTimes = [...new Set(parsed.data.BRIEF_TIMES ?? [parsed.data.BRIEF_TIME])].sort();
  return { ...parsed.data, briefTimes };
}
