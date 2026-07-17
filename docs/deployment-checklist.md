# Production checklist

Before exposing Redi beyond localhost:

- [ ] Run behind Tailscale or a TLS-terminating reverse proxy. Middleware sets security headers and HSTS when TLS is detected.
- [ ] Confirm `$DATA_DIR/.env` exists, is mode `0600`, and is backed up with `master.key`. Without them, encrypted data is permanently unrecoverable.
- [ ] Never expose MongrelDB port `8453`. Daemon mode must use both `--auth-users` and `--passphrase`.
- [ ] Never downgrade MongrelDB or Redi against an existing WAL v4 data directory.
- [ ] Set `CRON_SECRET` for external cron. Set `SCHEDULER_ENABLED=false` only when external cron drives ticks.
- [ ] Issue one MCP token per client and revoke unused tokens.
- [ ] Confirm login lockout, API rate limits, and `LOG_LEVEL=info`.
- [ ] Verify logs omit secrets, email bodies, chat bodies, and AI prompt bodies.
- [ ] Run unit, integration, and Playwright suites.
