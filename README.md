# Redi

Redi is a single-user, self-hosted web app that helps a college student plan their degree,
track course registration, track missing administrative items, and monitor their college
email via IMAP with AI triage and summaries. Redi is also the navy-blue cloud mascot who
guides setup and chats with full system access.

## Quick start (all-in-one container, recommended)

```bash
docker build -t redi .
docker run -d --name redi -p 3000:3000 -v ./redi-data:/data redi
# open http://localhost:3000 — first run lands on the login/setup screen
```

Works identically with Podman (`podman run ...`, rootless-friendly). `docker compose up`
uses the shipped `docker-compose.yml` (also works with `podman-compose`).

## Local development

```bash
npm install
npm run dev        # runs scripts/bootstrap-env.sh, then next dev; data in ./data
npm test           # unit tests (embedded MongrelDB in temp dirs)
npm run test:integration
npm run test:e2e
```

## State, backup, and versioning warnings

- Everything that matters lives under the data directory (`/data` in the image, `./data` locally):
  `db/` (MongrelDB), `.env` (DB credentials + encryption passphrase), `master.key`, `logs/`.
- **Backups must include `.env` and `master.key`.** Without the encryption passphrase and
  credentials the database is permanently unrecoverable.
- MongrelDB is pinned to v0.59.0 (WAL v4 storage boundary): **do not downgrade the image or
  npm packages against an existing data directory**.
- One process owns the data directory at a time (exclusive lock).
