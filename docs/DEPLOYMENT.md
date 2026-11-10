# Deployment

Current supported scope is **local development and a single machine**. Nothing in this repository is
deployed by the project; the Docker and Compose files describe how to run it yourself. Multi-instance
and managed-database deployments are not supported yet (see the SQLite caveat).

## Local development

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run db:setup
npm run dev
```

Web on http://localhost:5173, API on http://localhost:4000, docs on http://localhost:4000/docs.
Migrations and the demo seed run through `npm run db:setup`.

## Production: single machine with Compose

The image builds both apps, applies Prisma migrations on start, and serves the built SPA from the
API (`SERVE_WEB=1`).

```bash
# Generate a secret once and keep it out of shell history where possible.
export JWT_SECRET="$(openssl rand -base64 48)"
docker compose up -d --build
docker compose ps
curl -fsS http://localhost:4000/api/v1/health
```

Compose requires `JWT_SECRET` and refuses to start without it (`${JWT_SECRET:?...}`). Production
startup also rejects secrets shorter than 32 characters and known placeholders such as
`change-me` or `example`. The service binds `127.0.0.1:4000:4000`, so it is loopback-only by
default; put a TLS reverse proxy on the same host in front of it. Data lives in the named volume
`meridian_data` mounted at `/data`; the SQLite file is `/data/meridian.db`. The container drops all
Linux capabilities, sets `no-new-privileges`, runs as the non-root `node` user with a restrictive
umask, and creates `/data` as mode 700, so the database file and journals are owner-only.

The image is a multi-stage build: the runtime stage contains compiled API output, the web build,
Prisma schema/migrations, API source for the seed script, and installed dependencies (the Prisma CLI
is kept because migrations run on boot). npm/Vite caches and test artifacts are not copied, which
keeps the image modest.

Set `CORS_ORIGINS` to the public origin when the SPA is served from a different host than the API.
When the API serves the SPA itself, a single origin (for example `https://crm.example.com`) is
enough. `WEB_DIST_PATH` defaults to `/app/apps/web/dist`.

### Reverse proxy and TLS with Caddy

```caddyfile
crm.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:4000
}
```

Notes:

- Compose already binds `127.0.0.1:4000` only, so the API is reachable solely through Caddy on the
  same host. If the proxy lives elsewhere, change the mapping to `4000:4000` only with a host
  firewall that permits the proxy alone.
- `TRUST_PROXY` defaults to `false`: `X-Forwarded-*` headers are ignored unless you opt in. Behind
  Caddy, set `TRUST_PROXY=127.0.0.1` when the proxy shares the host network, or the proxy's exact
  address/CIDR (for example the Docker bridge gateway) when it forwards into the container. **Never
  set `TRUST_PROXY=true` on a directly exposed server**, and do not put an untrusted hop in front that
  lets clients spoof the headers. Rate limiting uses the client address derived from this setting.
- Caddy obtains and renews certificates automatically. No separate Certbot step.
- `COOKIE_SECURE` defaults to `1` when `NODE_ENV=production` and `0` otherwise. Compose overrides it
  to `0` because the loopback default is plain HTTP; set `COOKIE_SECURE=1` when TLS terminates in
  front of the container. A `Secure` cookie cannot be set over plain HTTP, so login would not persist.

### Environment variables

| Variable                       | Default                          | Notes                                                       |
| ------------------------------ | -------------------------------- | ----------------------------------------------------------- |
| `NODE_ENV`                     | `development`                    | `production` enables strict secret checks and defaults cookies to Secure. |
| `PORT`                         | `4000`                           | API listen port.                                            |
| `HOST`                         | `0.0.0.0`                        | Bind address; Compose publishes loopback only.              |
| `DATABASE_URL`                 | `file:./dev.db`                  | Compose sets `file:/data/meridian.db`.                      |
| `JWT_SECRET`                   | none                             | Required in production; random, at least 32 chars. Weak markers are rejected. |
| `ACCESS_TOKEN_TTL`             | `900`                            | Access token seconds.                                       |
| `REFRESH_TOKEN_TTL`            | `2592000`                        | Refresh token seconds (30 days).                            |
| `CORS_ORIGINS`                 | `http://localhost:5173`          | Comma-separated allowed browser origins.                    |
| `SERVE_WEB`                    | `0`                              | `1` serves the built SPA from the API.                      |
| `WEB_DIST_PATH`                | `../web/dist`                    | SPA directory; image sets `/app/apps/web/dist`.             |
| `WEB_APP_URL`                  | `http://localhost:5173`          | Used to build invite links.                                 |
| `TRUST_PROXY`                  | `false`                          | `false` ignores `X-Forwarded-*`. Set to `127.0.0.1` or the proxy CIDR only behind a trusted proxy. Never `true` when directly exposed. |
| `COOKIE_SECURE`                | `1` in production, else `0`      | Set `0` for local HTTP Compose, `1` behind TLS.             |

Generate secrets with `openssl rand -base64 48`. Never reuse the example value; placeholders and
short secrets are rejected when `NODE_ENV=production`.

## Migrations

The container runs `prisma migrate deploy` before starting the server, so every boot is
self-migrating. For manual control:

```bash
docker compose run --rm meridian npx --no-install prisma migrate deploy --schema prisma/schema.prisma
```

Create migrations during development with `npm run db:migrate -w @meridian/api` (never in
production). Commit the generated SQL. Because Prisma's SQLite migrations are sequential, do not
edit applied migrations.

### Optional: load the demo workspace

The runtime image applies migrations but never seeds automatically; production starts with the schema
and no demo records. Demo data is optional.

The seed is destructive: it deletes and recreates the `meridian-studio` workspace with its sample
companies, contacts, deals, and activities. Never run it against production or any database you
cannot restore.

Boot once so migrations have run and `/data/meridian.db` exists (the `docker compose up -d` above),
then run the seed against the same volume:

```bash
JWT_SECRET="$(openssl rand -base64 48)" docker compose run --rm meridian npx tsx prisma/seed.ts
```

The one-off container uses the service's `/data` volume, so it writes to the live database. The
runtime image includes `tsx`, `apps/api/src`, `prisma/seed.ts`, and the workspace dependencies, and
its working directory is `/app/apps/api`, so the imports resolve without extra mounts.

Demo login: `demo@meridian.studio` / `Meridian2026!`.

The Compose deployment serves the app at http://localhost:4000. `COOKIE_SECURE=0` is correct for
that plain-HTTP localhost deployment; set it to `1` when TLS terminates in front of the container.

## Backups and restore

SQLite is a single file; the data volume is the system of record.

**Stopped copy (simplest, consistent):**

```bash
docker compose stop meridian
docker run --rm -v meridiancrm_meridian_data:/data -v "$PWD":/backup alpine \
  cp /data/meridian.db "/backup/meridian-$(date +%F).db"
docker compose start meridian
```

**Online backup with the SQLite CLI** (safe while the app runs):

```bash
docker compose exec meridian sh -c \
  'command -v sqlite3 >/dev/null || exit 1; sqlite3 /data/meridian.db ".backup /data/meridian-backup.db"'
docker compose cp meridian:/data/meridian-backup.db ./meridian-backup.db
```

The runtime image may not include `sqlite3`; use the stopped-copy method if it does not. Restore by
stopping the service, replacing `/data/meridian.db` with the backup, and starting it again. Test the
restore on a spare volume before relying on it.

## Health checks

- Container healthcheck: `GET /api/v1/health` via Node `fetch`; 200 when the database answers, 503
  when it does not.
- External: deploy `infra/health-worker` (optional, not deployed here):
  1. Set `TARGET_URL` in `infra/health-worker/wrangler.toml` to the public origin.
  2. `cd infra/health-worker && npm install && npm run deploy`.
  3. Point a monitor (or CI synthetic check) at `https://meridian-health.<account>.workers.dev/health`.
  It returns 200/503 and is cached for 30 seconds at the edge. Alternatively run
  `curl -fsS https://crm.example.com/api/v1/health` from a monitoring service.
- `docker compose ps` shows the health state; restart policies cover crashes, not unhealthy hangs.

## Rolling upgrades

There is effectively one instance. `docker compose up -d --build` briefly stops the app, migrates,
and starts it again; expect a few seconds of downtime. A rolling upgrade would require multiple
instances, which SQLite cannot safely support. Take a backup before an upgrade that includes a
migration.

If a migration fails, the container does not start. Inspect logs with `docker compose logs meridian`,
restore the backup, and fix the migration before retrying.
