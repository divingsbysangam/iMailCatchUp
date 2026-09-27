# Security

Surface holds the keys to a real mailbox, so it is built to be conservative.
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
| Client IP | Taken from headers clients can't forge (Railway's `X-Real-IP`; Cloudflare's `CF-Connecting-IP` only with the origin secret), never from `X-Forwarded-For` |
| Origin lock (optional) | `REQUIRE_CLOUDFLARE=true` refuses requests that don't carry the secret header only your Cloudflare zone adds |
| Sessions | Random 256-bit token, only its SHA-256 stored; `__Host-` cookie, `HttpOnly`, `Secure`, `SameSite=Strict`; "sign out everywhere" |
| CSRF | SameSite=Strict + every non-GET request must carry `Origin: PUBLIC_ORIGIN` |
| Transport | HTTPS (Railway) + HSTS; IMAP over TLS with certificate verification on |
| Mailbox | Opened **read-only** by default. With `AUTO_ARCHIVE=true` / `MARK_READ_ON_OPEN=true` (opt-in) the app marks mail read and moves brief-bound mail to one folder; it never deletes mail in iCloud |
| Data at rest | Subjects, snippets, bodies, AI summaries and briefs encrypted with AES-256-GCM (`DATA_ENCRYPTION_KEY`). Sender name and address, recipients, dates and category are stored in plain text so lists can be sorted and filtered. Mail you open is removed (with `MARK_READ_ON_OPEN=true`); other mail is kept at most `SYNC_DAYS`, except open to-dos. Briefs are kept until the volume is wiped |
| Email rendering | DOMPurify → sandboxed iframe with scripts disabled → CSP allows images only from the app itself, so remote images load through a **private image proxy**: the server fetches them, so senders never see your IP address, location or browser (they can still tell the email was opened). The proxy only fetches public http(s) addresses on standard ports (checked at connect time), images only, max 5 MB |
| Mail tab (folders, search) | Read live from iCloud with read-only folder access and `BODY.PEEK` fetches (never marks mail read); results aren't stored or sent to OpenAI |
| Attachments | Not stored. Fetched from iCloud when you tap one; served as a download (never rendered in the app), active types like HTML/SVG forced to `application/octet-stream` |
| Headers | Strict CSP, `frame-ancestors 'none'`, `no-referrer`, `no-store` on API responses |
| AI | Emails are passed as JSON data and the model is told to treat them as untrusted; it has no tools, and its output is schema-validated |
| Push | Payloads are end-to-end encrypted (RFC 8291); set `BRIEF_PUSH_PREVIEW=false` to keep content off the lock screen |
| Container | Runs as non-root `node` user |
| Supply chain | Dependabot, `npm audit`, gitleaks secret scanning in CI |

## What you are trusting

- **Railway** hosts the container, env vars and volume. They can technically access them.
- **Cloudflare** (if you proxy through it) terminates HTTPS, so it can technically see everything the app sends to your browser, including email content and your login.
- **OpenAI** receives the sender, subject, date and a trimmed excerpt (quoted replies, signatures and links removed; max `BRIEF_BODY_CHARS`, default 800 characters) of **every newly synced email**, once, to screen it. Newsletters and automated notifications are sent the same way, with their boilerplate removed (max `BRIEF_BULK_CHARS`, default 800). At brief time it receives only the senders, subjects and the summaries it wrote earlier.
  Under OpenAI's API terms, API data isn't used for training by default, but it may be retained for a period for abuse monitoring.
  Check their current policy; if that's not acceptable, don't enable briefs.
- **Google (FCM)** delivers push messages for Android Chrome but can't read the encrypted payload.

## Operational advice

- Set a **monthly spend limit** on your OpenAI key.
- If a phone is lost: Settings → *Sign out everywhere*, then rotate `ICLOUD_APP_PASSWORD` at appleid.apple.com.
- Keep a private backup of `DATA_ENCRYPTION_KEY`; rotating it makes stored mail/briefs unreadable (mail re-syncs, old briefs are lost).
- To rotate the login password or TOTP, run `npm run setup` again and update the variables.
- If `CLOUDFLARE_ORIGIN_SECRET` leaks, generate a new one and update it in both Railway and the Cloudflare Transform Rule.
