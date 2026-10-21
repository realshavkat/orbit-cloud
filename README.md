# Orbit Cloud

The community service of the [Orbit browser](https://github.com/realshavkat/orbit): accounts, public
profiles, badges, friends, shared sites and collections, donations, moderation and administration.

It is optional. Every feature of the browser stays free and works without an account; if this
service is down, browsing is not affected.

- **API**: Node.js 22+, Fastify, PostgreSQL (`api.mjs`), versioned under `/api/v1`.
- **Web app**: plain HTML/CSS/JS served by the API (`web/`), in Orbit's look, French and English.
- **Database server**: PostgreSQL run from portable binaries (`db.mjs`), with nightly dumps.

## Run locally

```sh
npm install
npm test            # starts a throwaway PostgreSQL, runs the 49 tests
node scripts/dev.mjs  # PostgreSQL in ./.dev-pg + API on http://localhost:8790
```

Without SMTP, e-mails are not sent; with `NODE_ENV=development` (the default) their text is printed
in the console so sign-up can be tested.

## Configuration

Every setting comes from environment variables; `.env.example` lists them with placeholder values.
Secrets have no default: a missing secret disables its feature (donations, 2FA, e-mail), it never
falls back to a built-in value. Never commit `.env`.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `APP_BASE_URL` | API | Public URL (links in e-mails, cookie security). Must be `https://` in production. |
| `DATABASE_URL` | API | `postgres://orbit:<password>@<host>:<port>/orbit` |
| `NODE_ENV` | API | `production` on the server. |
| `MFA_ENCRYPTION_KEY` | API | 32 random bytes (hex): encrypts TOTP secrets at rest. |
| `INITIAL_OWNER_ID` | API | Account id of the original owner (see "Owner"). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | API | Outgoing e-mail. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | API | Donations. Both empty = donations shown as "not configured". |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | API | Optional Cloudflare Turnstile on sign-up. |
| `TRUST_PROXY` | API | `true` only behind a reverse proxy. |
| `PG_SUPERUSER_PASSWORD`, `PG_APP_PASSWORD` | DB | Passwords of `postgres` (used only by `db.mjs`) and of the `orbit` role the API uses. |

## Owner

There is no endpoint that creates an owner. The owner is set once, from the server:

1. Sign up on the site with the owner's account and confirm the e-mail.
2. Copy the account id (Administration › Users, or `SELECT id FROM users WHERE username = '…'`).
3. Set `INITIAL_OWNER_ID` to that id and restart the API.

At start the API gives that account the Owner role, the Founder badge and the Administrator badge,
then records `owner_bootstrap` in `app_settings`. From then on the variable is ignored; changing it
does nothing. The Founder badge is protected: no API call can award or remove it.

## Roles, permissions, badges

- Roles (`user`, `supporter`, `moderator`, `administrator`, `owner`) map to explicit permissions in
  `role_permissions`; nothing is inherited. Every admin route checks a permission on the server.
- Nobody acts on an account of equal or higher rank, nobody changes their own roles, and no route
  can grant `owner`. Administrators manage moderators; only the owner manages administrators.
- Badges never grant permissions. The Administrator and Moderator badges follow the roles.
- Sensitive actions (roles, official badges, donation settings, 2FA reset) need the password typed
  again in the last 10 minutes.
- `admin_audit_logs` is append-only: a database trigger refuses updates and deletes.

## Donations

Stripe Checkout, one-time or monthly. A donation counts only after a signed Stripe webhook
(`/api/v1/webhooks/stripe`); the "thank you" page changes nothing. Events are stored by Stripe id,
so replays and duplicates are ignored, and each one is processed in a transaction.

Badge rule: confirmed donations **net of refunds** (disputed payments count for nothing). Supporter =
a first donation not fully refunded; Bronze/Silver/Gold/Platinum = net total thresholds
(Administration › Donations); Monthly Supporter = an active subscription, removed when it ends or is
unpaid. Amounts are never shown publicly.

To enable: create a Stripe account, set `STRIPE_SECRET_KEY`, add a webhook endpoint
`https://<domain>/api/v1/webhooks/stripe` with the events `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`,
`customer.subscription.created|updated|deleted`, `charge.refunded`, `charge.dispute.created|closed`,
then set `STRIPE_WEBHOOK_SECRET`. Refunds are made in Stripe; they come back through the webhook.

## Privacy

- The browser never sends history, tabs, bookmarks or private browsing data. A site reaches the
  server only when the member clicks "Share this site", and only as a domain name.
- Sharing is off by default; turning it off hides what was shared and refuses new shares.
- Sensitive domains (health, banking, dating, adult, religion, politics, government…) are refused.
- A site lists its members only from 3 members (`SITE_MIN_MEMBERS`).
- Each profile field has its own visibility switch, applied in the API (hidden data is never sent).
- "Popular" members = most friends; "active" = signed in in the last 7 days and sharing activity.
- Retention: sessions and sign-in attempts 30 days, notifications 90 days after archiving (1 year
  max), donations 10 years (accounting), audit log kept. Account deletion removes the profile and
  all social data at once; donations stay, detached from any visible profile.

## Deployment on Pelican

Two servers on the Node.js egg, both cloning this repository:

| Server | Startup | Allocation |
| --- | --- | --- |
| Orbit PostgreSQL | `node db.mjs` | on the Docker bridge address (`172.18.0.1:<port>`): reachable by other servers on the node, not from the Internet |
| Orbit API | `node api.mjs` | public port, behind an HTTPS reverse proxy once a domain exists |

The database server creates its cluster on first start (`./pgdata`), the `orbit` database and the
`orbit` role (no superuser, no CREATEDB, owner of its database only, 30 connections max), allows
connections only from private networks with scram-sha-256, and writes a dump every night at 03:00 UTC
in `./backups` (14 kept). Type `backup` in its console for an immediate dump.

**Restore test**: in the database server's console directory, `node scripts/restore-check.mjs`
restores the newest dump into a scratch database, prints row counts and drops it.

**Restore for real**: stop the API, then
`pg_restore -h 127.0.0.1 -p <port> -U postgres -d orbit --clean --if-exists backups/<file>.dump`
(the binaries are in `node_modules/@embedded-postgres/linux-x64/native/bin`), start the API.
Also download `backups/` regularly (or use Pelican backups) so a copy lives off the node.

**Update**: push to `main`, restart the server: it runs `git pull`, `npm ci` and the migrations
(`schema_migrations`, each file applied once, in order, in a transaction).

**Roll back**: `git checkout <previous commit>` in the server's files and restart. Migrations only
move forward: restore the dump taken before the update if a migration must be undone.

**Health**: `GET /api/health` answers `{ "ok": true }` when the API and the database respond.

### HTTPS

Until a domain points to the server, the API is reachable over plain HTTP at its IP and port: fine
for tests, **not for real accounts** (passwords would travel unencrypted). For production:
point a domain at the node, put Caddy or Nginx with a certificate in front of the API's port, set
`APP_BASE_URL=https://<domain>` and `TRUST_PROXY=true`. Cookies then become `Secure` automatically.

## API

`/api/v1/auth` sign-up, verify, login (+2FA), logout, reset · `/me` profile, media, privacy,
preferences, sessions, password, e-mail, 2FA, donations, export, delete · `/users` search, discover,
profiles, media · `/badges` catalog, details, award checks · `/friends` requests, friends, blocks ·
`/notifications` · `/sites` shared sites, collections, site members · `/donations` info, checkout,
portal · `/webhooks/stripe` · `/reports` · `/admin` stats, users, roles, badges, donations,
webhooks, reports, moderation, appeals, audit.

State-changing calls need the header `X-Orbit-Request: 1` (cookies alone are refused) and, when
present, an `Origin` equal to `APP_BASE_URL`.

## OAuth (prepared)

`oauth_accounts` is ready for Discord, Google and GitHub. No provider is enabled: each one needs the
full flow (state, PKCE, redirect URI check, provider identity) and an explicit linking step; e-mails
are never used to link accounts automatically.
