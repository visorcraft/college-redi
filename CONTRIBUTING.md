# Contributing to Redi

Thanks for helping improve Redi.

## Before You Start

- Search existing issues before opening a new one.
- Open an issue before a large change so the approach can be discussed.
- Keep changes focused. Do not include credentials, personal data, generated application data, or local paths.

## Development

Redi requires Node.js 22 or newer.

```bash
cp .env.example .env
npm install
npm run dev
```

Before opening a pull request, run the checks related to your change:

```bash
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
```

## Pull Requests

- Explain what changed and why.
- Add or update the smallest relevant test for behavior changes.
- Update documentation when behavior or configuration changes.
- Never commit `.env` files, credentials, student records, email contents, database files, or other private data.

By contributing, you agree that your contribution is licensed under GPL-3.0-only.
