# Surface

*(repository: iMailCatchUp)*

Self-hosted, single-user **iCloud Mail reader** with an **AI screener** and **twice-daily briefs** delivered as **push notifications** to your Android phone. Styled with the Divings Field System.

- 📬 Read your iCloud inbox from any browser; install it on Android as an app (PWA)
- 🌙 Every evening, GPT summarises the day's mail: headline, highlights, to-dos
- 🔔 Web Push notification when the brief is ready
- 🔒 Password + authenticator-app login, encrypted storage, read-only mailbox access. See [SECURITY.md](SECURITY.md)

```
iCloud IMAP ──(read-only, TLS)──▶ Server (Node/Fastify) ──▶ SQLite (encrypted fields)
                                    │  every 10 min: sync
                                    │  AI screener: "Needs you" vs. brief (+ optional iCloud archiving)
                                    │  at BRIEF_TIMES: brief → Web Push ──▶ 📱
                                    ▼
                          PWA (React) served by the same server
```

## Deploy on Railway (about 15 minutes)

### 1. Get your credentials

1. **iCloud app-specific password:** [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords → generate one. Two-factor auth must be on.
2. **OpenAI API key:** [platform.openai.com](https://platform.openai.com/api-keys). Set a monthly budget limit.
3. **App secrets:** on your computer (Node 22+):
   ```bash
   git clone https://github.com/<you>/iMailCatchUp && cd iMailCatchUp
   npm ci
   npm run setup
   ```
   Choose a login password. It prints `APP_PASSWORD_HASH`, `TOTP_SECRET`, `DATA_ENCRYPTION_KEY` and the VAPID keys.
   Add `TOTP_SECRET` to an authenticator app (Google Authenticator, Aegis, 1Password...).

### 2. Create the Railway service

1. Railway → **New Project → Deploy from GitHub repo** → pick your fork. It builds from the `Dockerfile`.
2. Service → **Settings → Networking → Generate Domain** (or add your own domain).
3. Right-click the service → **Attach Volume**, mount path **`/data`**. Without a volume, data is lost on every deploy.
4. Service → **Variables**: add everything from [`.env.example`](.env.example), with these values:
   - `NODE_ENV=production`
   - `PUBLIC_ORIGIN=https://<your-domain>` (exactly the URL you open; no trailing path)
   - `DATABASE_PATH=/data/app.db`
   - `BRIEF_TIMES` / `BRIEF_TIMEZONE`, e.g. `08:30,18:00` / `Asia/Kolkata`
   - the secrets from step 1
   - Don't set `PORT`: Railway provides it.
5. Deploy. `/healthz` should return `{"ok":true}`.

Keep it at **1 replica**: SQLite and the scheduler assume a single instance.

### 3. Install on Android

1. Open `https://<your-domain>` in **Chrome** and sign in (password + 6-digit code).
2. Chrome menu ⋮ → **Add to Home screen / Install app**.
3. Open the app → **Settings → Enable on this device** → allow notifications → **Send test**.

Briefs arrive at each of `BRIEF_TIMES`. If the server was down at a brief time, the most recent missed brief runs as soon as it's back.

### How mail is handled

- Every new unread email is **screened** by the AI: mail from people expecting a reply goes to **Needs you**; everything else (bills, receipts, calendar, newsletters, notifications…) waits for the next **brief**, grouped by category with a one-line summary.
- New mail is picked up within about a minute (`IMAP_IDLE`), and you get a notification straight away when an email needs you (`NEEDS_YOU_PUSH`).
- Mark anything as a **to-do**; it stays on the To-dos page until you tick it off.
- **Mail** tab: browse any iCloud folder and search your whole mailbox, live and read-only. Nothing from it is stored, sent to the AI or marked read.
- With `MARK_READ_ON_OPEN=true`, closing an email you opened marks it read in iCloud and removes the app's copy
  (press **Keep unread** first to leave it alone; open to-dos stay). If iCloud is unreachable the change is queued
  and retried on the next sync.
- With `AUTO_ARCHIVE=true`, brief-bound mail is also marked read and moved to `ARCHIVE_FOLDER` in iCloud, so your iCloud inbox only holds what needs you. This gives the app write access to your mailbox; only mail received after you switch it on is moved.
You can also tap **Brief me now** on the Briefs tab.

### Optional: put it behind Cloudflare

If your domain's DNS is on Cloudflare, you can proxy the app through it (orange cloud) and lock the
Railway service so it only accepts traffic from your Cloudflare zone:

1. Railway → service → Settings → **+ Custom Domain** (e.g. `brief.example.com`). Add the **CNAME**
   (proxied, orange cloud) and **TXT** records it shows in Cloudflare → DNS.
2. Cloudflare → **Rules → Configuration Rules**: hostname equals your subdomain → **SSL: Full**
   (Railway requires Full; *Full (strict)* won't work). This avoids changing the whole zone's SSL mode.
3. Cloudflare → **Rules → Transform Rules → Modify Request Header**: hostname equals your subdomain →
   **Set static** header `X-Origin-Auth` = the `CLOUDFLARE_ORIGIN_SECRET` from `npm run setup`.
4. Railway variables: `CLOUDFLARE_ORIGIN_SECRET=<same value>`. Check the app works via the subdomain,
   then set `REQUIRE_CLOUDFLARE=true`, set `PUBLIC_ORIGIN` to the subdomain, and remove the
   `*.up.railway.app` domain.
5. Optional: Cloudflare → Security → WAF → Custom rules → block countries you never log in from.

## Configuration

See [`.env.example`](.env.example) for every variable. Highlights:

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_MODEL` | `gpt-5-mini` | Any chat-completions model that supports JSON mode |
| `BRIEF_TIMES` / `BRIEF_TIMEZONE` | `BRIEF_TIME` (19:00) / `UTC` | Comma-separated 24h times, IANA time zone |
| `AUTO_ARCHIVE` / `ARCHIVE_FOLDER` | `false` / `iMailCatchUp Brief` | Move brief-bound mail out of the iCloud inbox |
| `MARK_READ_ON_OPEN` | `false` | Closing an email marks it read in iCloud and removes the app's copy |
| `MAILBOXES` | `INBOX` | Comma-separated IMAP folders |
| `SYNC_DAYS` | `14` | How much mail is kept locally |
| `SYNC_UNREAD_ONLY` | `true` | Only unread mail is synced; mail you read elsewhere is removed on the next sync |
| `BRIEF_PUSH_PREVIEW` | `true` | `false` keeps email content off the lock screen |
| `BRIEF_BODY_CHARS` | `800` | Per-email characters sent to the AI (see below) |
| `BRIEF_BULK_CHARS` | `800` | Same for newsletters/notifications; `0` = sender + subject only |

### Keeping AI costs low

Before emails go to the model, each one is trimmed: quoted reply history, `>` lines, signatures,
"Sent from my iPhone" footers and URLs are removed, and the rest is cut to `BRIEF_BODY_CHARS`.
Newsletters and automated notifications (detected by `List-Unsubscribe` / `List-Id` / `Precedence` /
`Auto-Submitted` headers or no-reply sender names) also have "view in browser" lines, unsubscribe
footers and copyright notices removed, are cut to `BRIEF_BULK_CHARS`, and get a one-line summary each
in the brief's **Newsletters** section.
Each brief records the tokens it used; you can see them at the bottom of the brief and in the server logs.

## Local development

```bash
npm ci
cp .env.example .env   # fill in, including output of `npm run setup`
npm run dev:server     # API on :3000
npm run dev:web        # PWA on :5173 (proxies /api)
npm test
```

## Limitations (v0.1)

- No sending or replying (by design for now); archiving and marking read are opt-in (`AUTO_ARCHIVE`, `MARK_READ_ON_OPEN`)
- Web Push on Android needs Chrome (or another browser with Push API support)

## License

[MIT](LICENSE)
