# Security

iMailCatchUp holds the keys to a real mailbox, so it is built to be conservative.
This page explains the threat model and what protects you.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** (Security → Advisories) rather than a public issue.

## What's at stake

An iCloud **app-specific password** grants full IMAP/SMTP access to your mailbox
(Apple does not offer read-only app passwords). Treat it like your main password.

## Protections

| Area | Measure |
|---|---|
| Login | Password (scrypt) **and** TOTP code; TOTP codes can't be replayed; 5 attempts / 15 min per IP |
| Sessions | Random 256-bit token, only its SHA-256 stored; `__Host-` cookie, `HttpOnly`, `Secure`, `SameSite=Strict`; "sign out everywhere" |
| CSRF | SameSite=Strict + every non-GET request must carry `Origin: PUBLIC_ORIGIN` |
| Transport | HTTPS (Railway) + HSTS; IMAP over TLS with certificate verification on |
| Mailbox | Opened **read-only**: the app never changes flags, moves or deletes mail |
| Data at rest | Subjects, snippets, bodies and briefs encrypted with AES-256-GCM (`DATA_ENCRYPTION_KEY`); only the last `SYNC_DAYS` of mail kept |
| Email rendering | DOMPurify → sandboxed iframe (no scripts, opaque origin) → CSP blocks remote images (no tracking pixels) |
| Headers | Strict CSP, `frame-ancestors 'none'`, `no-referrer`, `no-store` on API responses |
| AI | Emails are passed as JSON data and the model is told to treat them as untrusted; it has no tools, and its output is schema-validated |
| Push | Payloads are end-to-end encrypted (RFC 8291); set `BRIEF_PUSH_PREVIEW=false` to keep content off the lock screen |
| Container | Runs as non-root `node` user |
| Supply chain | Dependabot, `npm audit`, gitleaks secret scanning in CI |

## What you are trusting

- **Railway** hosts the container, env vars and volume. They can technically access them.
- **OpenAI** receives the sender, subject and first ~1,500 characters of each email in the brief window.
  Under OpenAI's API terms, API data isn't used for training by default, but it may be retained for a period for abuse monitoring.
  Check their current policy; if that's not acceptable, don't enable briefs.
- **Google (FCM)** delivers push messages for Android Chrome but can't read the encrypted payload.

## Operational advice

- Set a **monthly spend limit** on your OpenAI key.
- If a phone is lost: Settings → *Sign out everywhere*, then rotate `ICLOUD_APP_PASSWORD` at appleid.apple.com.
- Keep a private backup of `DATA_ENCRYPTION_KEY`; rotating it makes stored mail/briefs unreadable (mail re-syncs, old briefs are lost).
- To rotate the login password or TOTP, run `npm run setup` again and update the variables.
