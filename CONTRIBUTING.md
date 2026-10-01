# Contributing

Thanks for your interest in iMailCatchUp. It's a small, single-user app, so changes are kept focused:
a reader and briefer for one iCloud mailbox, deployed by the person who owns it.

## Before you start

- **Bugs:** open an issue with the **Bug report** template. Include the server log lines around the problem
  (they never contain mail content or secrets, but check before pasting).
- **Features:** open an issue with the **Feature request** template first, so we can agree on the approach
  before you write code.
- **Security problems:** don't open a public issue. Follow [SECURITY.md](SECURITY.md).

## Development setup

Requires Node 22+.

```bash
npm ci
cp .env.example .env   # fill in, including the output of `npm run setup`
npm run dev:server     # API on :3000
npm run dev:web        # PWA on :5173 (proxies /api)
```

You need a real iCloud account with an app-specific password and an OpenAI API key to run the app end to end.
The test suite doesn't need either.

## Checks

CI runs these on every pull request; run them locally before pushing:

```bash
npm run typecheck
npm test
npm run build
```

CI also scans every commit for secrets (gitleaks) and builds the Docker image.

## Pull requests

- Keep each PR to one change, and explain the why in the description.
- Add or update tests in `server/test` for server behaviour you change.
- Update `README.md`, `.env.example` and `SECURITY.md` when you add a setting or change what data leaves the server.
- Never commit `.env`, real email content, keys or passwords. Use made-up data in tests.

## Ground rules

- The mailbox is opened read-only unless the user opts in (`AUTO_ARCHIVE`, `MARK_READ_ON_OPEN`).
  Changes must keep that default and must never delete mail.
- Email content is untrusted input: keep it sandboxed in the UI and treated as data in AI prompts.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
