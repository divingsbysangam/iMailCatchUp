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

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
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
  /** When false, the notification only says a brief is ready (nothing about content on the lock screen). */
  BRIEF_PUSH_PREVIEW: bool.default(true),

  /** Output of `npm run setup`. */
  APP_PASSWORD_HASH: z.string().startsWith("scrypt:"),
  TOTP_SECRET: z.string().regex(/^[A-Z2-7]{32,}$/, "base32, from `npm run setup`"),
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((k) => Buffer.from(k, "base64").length === 32, "must be 32 bytes, base64"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 14),

  VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/, "mailto: or https:// URL"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${issues.join("\n")}`);
  }
  return parsed.data;
}
