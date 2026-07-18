# Production checklist

Before exposing Redi beyond localhost:

- [ ] Keep Redi bound to `127.0.0.1:3000`; expose it only through Tailscale or a TLS-terminating reverse proxy. Middleware sets security headers and HSTS when TLS is detected.
- [ ] Set `TRUST_PROXY_HOPS` to the exact reverse-proxy count. Leave it `0` without a proxy.
- [ ] Claim the installation with `REDI_SETUP_TOKEN` from `$DATA_DIR/.env`.
- [ ] Confirm `$DATA_DIR/.env` exists, is mode `0600`, and is backed up with `master.key`. Without them, encrypted data is permanently unrecoverable.
- [ ] Never expose MongrelDB port `8453`. Daemon mode must use both `--auth-users` and `--passphrase`.
- [ ] Never downgrade MongrelDB or Redi against an existing data directory.
- [ ] Set `CRON_SECRET` for external cron. Set `SCHEDULER_ENABLED=false` only when external cron drives ticks.
- [ ] Issue one MCP token per client and revoke unused tokens.
- [ ] Confirm login lockout, API rate limits, and `LOG_LEVEL=info`.
- [ ] Verify logs omit secrets, email bodies, chat bodies, and AI prompt bodies.
- [ ] Run unit, integration, and Playwright suites.
