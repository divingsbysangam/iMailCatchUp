# iMailCatchUp

Self-hosted, single-user **iCloud Mail reader** with an **AI evening brief** delivered as a **push notification** to your Android phone.

- 📬 Read your iCloud inbox from any browser; install it on Android as an app (PWA)
- 🌙 Every evening, GPT summarises the day's mail: headline, highlights, to-dos
- 🔔 Web Push notification when the brief is ready
- 🔒 Password + authenticator-app login, encrypted storage, read-only mailbox access. See [SECURITY.md](SECURITY.md)

```
iCloud IMAP ──(read-only, TLS)──▶ Server (Node/Fastify) ──▶ SQLite (encrypted fields)
                                    │  every 10 min: sync
                                    │  at BRIEF_TIME: OpenAI → brief → Web Push ──▶ 📱
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
   - `BRIEF_TIME` / `BRIEF_TIMEZONE`, e.g. `19:00` / `Asia/Kolkata`
   - the secrets from step 1
   - Don't set `PORT`: Railway provides it.
5. Deploy. `/healthz` should return `{"ok":true}`.

Keep it at **1 replica**: SQLite and the scheduler assume a single instance.

### 3. Install on Android

1. Open `https://<your-domain>` in **Chrome** and sign in (password + 6-digit code).
2. Chrome menu ⋮ → **Add to Home screen / Install app**.
3. Open the app → **Settings → Enable on this device** → allow notifications → **Send test**.

The evening brief arrives at `BRIEF_TIME`. If the server was down then, it runs as soon as the server is back (same day).
You can also tap **Brief me now** on the Briefs tab.

## Configuration

See [`.env.example`](.env.example) for every variable. Highlights:

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_MODEL` | `gpt-5-mini` | Any chat-completions model that supports JSON mode |
| `BRIEF_TIME` / `BRIEF_TIMEZONE` | `19:00` / `UTC` | 24h time, IANA time zone |
| `MAILBOXES` | `INBOX` | Comma-separated IMAP folders |
| `SYNC_DAYS` | `14` | How much mail is kept locally |
| `BRIEF_PUSH_PREVIEW` | `true` | `false` keeps email content off the lock screen |
| `BRIEF_BODY_CHARS` | `800` | Per-email characters sent to the AI (see below) |

### Keeping AI costs low

Before emails go to the model, each one is trimmed: quoted reply history, `>` lines, signatures,
"Sent from my iPhone" footers and URLs are removed, and the rest is cut to `BRIEF_BODY_CHARS`.
Newsletters and automated notifications (detected by `List-Unsubscribe` / `List-Id` / `Precedence` /
`Auto-Submitted` headers or no-reply sender names) send only the sender and subject.
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

- Read-only: no sending, replying, archiving or marking as read (by design for now)
- Attachments aren't downloadable in the app
- Web Push on Android needs Chrome (or another browser with Push API support)
- Messages are synced every `SYNC_INTERVAL_MINUTES`, not instantly

## License

[MIT](LICENSE)
