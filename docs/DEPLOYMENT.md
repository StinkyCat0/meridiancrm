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
Prisma client generation, migrations, and the demo seed run through `npm run db:setup`.

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

| Variable            | Default                     | Notes                                                                                                                                  |
| ------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`          | `development`               | `production` enables strict secret checks and defaults cookies to Secure.                                                              |
| `PORT`              | `4000`                      | API listen port.                                                                                                                       |
| `HOST`              | `0.0.0.0`                   | Bind address; Compose publishes loopback only.                                                                                         |
| `DATABASE_URL`      | `file:./dev.db`             | Compose sets `file:/data/meridian.db`.                                                                                                 |
| `JWT_SECRET`        | none                        | Required in production; random, at least 32 chars. Weak markers are rejected.                                                          |
| `ACCESS_TOKEN_TTL`  | `900`                       | Access token seconds.                                                                                                                  |
| `REFRESH_TOKEN_TTL` | `2592000`                   | Refresh token seconds (30 days).                                                                                                       |
| `CORS_ORIGINS`      | `http://localhost:5173`     | Comma-separated allowed browser origins.                                                                                               |
| `SERVE_WEB`         | `0`                         | `1` serves the built SPA from the API.                                                                                                 |
| `WEB_DIST_PATH`     | `../web/dist`               | SPA directory; image sets `/app/apps/web/dist`.                                                                                        |
| `WEB_APP_URL`       | `http://localhost:5173`     | Used to build invite links.                                                                                                            |
| `TRUST_PROXY`       | `false`                     | `false` ignores `X-Forwarded-*`. Set to `127.0.0.1` or the proxy CIDR only behind a trusted proxy. Never `true` when directly exposed. |
| `COOKIE_SECURE`     | `1` in production, else `0` | Set `0` for local HTTP Compose, `1` behind TLS.                                                                                        |

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

SQLite is a single file, so the data volume is the system of record. Two scripts in `scripts/` take
and restore verified snapshots:

- `scripts/backup-sqlite.sh` writes an online, WAL-safe snapshot with `sqlite3 ".backup"` when the
  CLI is installed, or `VACUUM INTO` through the repository's Prisma CLI otherwise. It checks
  `PRAGMA integrity_check`, writes through a temporary file, and renames atomically.
- `scripts/restore-sqlite.sh` validates the snapshot, moves the current database aside as
  `<db>.pre-restore.<UTC timestamp>`, and installs the copy. It requires `--force`; without it the
  script only prints the plan and exits non-zero.

Both read `DATABASE_URL` (a Prisma `file:` URL) or `DB_PATH`, default to
`apps/api/prisma/dev.db`, resolve relative `DATABASE_URL` paths against `apps/api/prisma` exactly as
Prisma does, and chmod the result 600. `BACKUP_DIR` defaults to `<repo>/backups` and is created mode 700. The scripts print paths and byte counts, never `DATABASE_URL` or credentials.

### Online backup

From the repository root, against a local file:

```bash
DB_PATH=/srv/meridian/data/meridian.db \
  BACKUP_DIR=/srv/backups/meridian \
  scripts/backup-sqlite.sh
```

With the Compose deployment, copy the script into the running container (the runtime image does not
include `scripts/`) and write the snapshot to the data volume:

```bash
docker compose exec -T meridian mkdir -p /data/scripts
docker compose cp scripts/backup-sqlite.sh meridian:/data/scripts/backup-sqlite.sh
docker compose exec -T meridian env BACKUP_DIR=/data/backups sh /data/scripts/backup-sqlite.sh
docker compose cp meridian:/data/backups/meridian-<timestamp>.db ./meridian.db
```

The fallback snapshot needs the Prisma CLI, which the runtime image keeps for migrations, and a
verifier: `sqlite3` or Node >= 22.5 with `node:sqlite`. If neither is available the script fails
rather than keep an unverified file.

### Schedule and retention

Example host crontab (keep at least one copy off the host):

```cron
15 3 * * * cd /srv/meridian && DB_PATH=/srv/meridian/data/meridian.db BACKUP_DIR=/srv/backups/meridian scripts/backup-sqlite.sh >>/var/log/meridian-backup.log 2>&1
0 4 * * * find /srv/backups/meridian -name 'meridian-*.db' -type f -mtime +14 -delete
```

Keep a daily series long enough to cover your worst recovery point (for example 14 daily plus a
monthly copy). Backups contain every workspace record and are not encrypted by the scripts; store
them on a restricted, encrypted volume and copy them off the machine. Verify permissions: `600` on
each file, `700` on the directory.

### WAL notes

- Never `cp` a live `meridian.db`; with WAL enabled the copy can miss committed pages in
  `meridian.db-wal`. Use the scripts, `sqlite3 ".backup"`, `VACUUM INTO`, or a stopped copy that also
  includes the `-wal` and `-shm` files.
- `sqlite3 ".backup"` restarts a read transaction against the live database, so it is safe while the
  API is running. `VACUUM INTO` also reads a consistent snapshot.
- Stop the API before restoring. `restore-sqlite.sh` refuses when `lsof` shows an open handle and
  refuses while `-wal`/`-shm`/`-journal` files exist. After an unclean shutdown those files can be
  stale; confirm no process holds the database, then set `ALLOW_WAL_PRESENT=1` (the script moves the
  journal files aside with the old database).
- Restore as the user that owns the data directory (the container's `node` user under Compose), or
  chown the file afterwards. A root-owned database is not writable by the service.

### Restore drill

Run this before you need it, against a scratch path:

```bash
mkdir -p /tmp/drill
scripts/restore-sqlite.sh /srv/backups/meridian/meridian-<timestamp>.db   # dry run, exit 1
DB_PATH=/tmp/drill/meridian.db scripts/restore-sqlite.sh --force /srv/backups/meridian/meridian-<timestamp>.db
DATABASE_URL=file:/tmp/drill/meridian.db JWT_SECRET="$(openssl rand -base64 48)" PORT=4100 \
  npm run dev:api
curl -fsS http://127.0.0.1:4100/api/v1/health
```

Log in, open a customer and an invoice, confirm the payment ledger totals match the dashboard, then
stop the process and remove the scratch copy. The dry run exits non-zero by design; that is not a
failed drill.

For production restore:

```bash
docker compose exec -T meridian mkdir -p /data/scripts
docker compose cp scripts/restore-sqlite.sh meridian:/data/scripts/restore-sqlite.sh
docker compose cp ./meridian-<timestamp>.db meridian:/data/meridian-restore.db
docker compose stop meridian
docker compose run --rm --no-deps -e DB_PATH=/data/meridian.db meridian \
  sh /data/scripts/restore-sqlite.sh --force /data/meridian-restore.db
docker compose start meridian
curl -fsS http://127.0.0.1:4000/api/v1/health
```

After validating the restored data, remove the staged `/data/meridian-restore.db` and apply the
retention policy to the `.pre-restore.<timestamp>` copy; both are unencrypted copies of customer
data.

## Scheduled automation sweep

`.github/workflows/automations.yml` calls `POST /api/v1/automations/run-due` hourly and on manual
dispatch. It evaluates overdue invoices and jobs scheduled in the next 24 hours for one workspace,
using the same engine and audit entry (`automation.run_due`) as the admin button in the application.

Repository configuration (Settings → Secrets and variables → Actions):

- Variable `MERIDIAN_API_URL`: the public API origin, for example `https://crm.example.com`.
  Localhost HTTP is accepted for testing.
- Secret `MERIDIAN_CRON_TOKEN`: an access token for an ADMIN member of the target workspace. The
  workflow sends it as `Authorization: Bearer` and never prints it; bash tracing stays off.

If either value is missing the job logs a notice and succeeds without calling the API. The job has no
repository permissions, checks out no code, serializes runs with a workflow-level concurrency group,
and times out after five minutes. `curl --fail-with-body` retries transient failures.

### Token scope and lifetime

`run-due` requires ADMIN and is scoped to the authenticated workspace. The token is the same
15-minute access JWT issued by `POST /auth/login`; the API has no long-lived service credential yet.
A static repository secret therefore expires unless the operator does one of the following:

- keep the schedule off and use manual dispatch with a freshly minted token, or
- raise `ACCESS_TOKEN_TTL` on the API to the rotation interval they accept and rotate
  `MERIDIAN_CRON_TOKEN` at that cadence, understanding that every access token then lives longer, or
- add a dedicated automation credential to the API before enabling unattended runs.

The workflow does not mint or refresh tokens. A 401/403 fails the run with a message to rotate the
secret and cannot mutate data. Use a dedicated service user whose only role is ADMIN in the target
workspace, and store its token only in the Actions secret.

### Multi-workspace deployments

The endpoint sweeps one workspace per call. Run the workflow once per workspace with its own URL and
token (a second workflow file or a parameterized reusable workflow), or add an admin-wide endpoint
before relying on a single hourly job for many tenants.

### Idempotence and rollout

The sweep is idempotent: the same rule cannot run twice for the same trigger and entity within 24
hours, so retries and overlapping dispatches do not duplicate tasks or messages. The dedupe check
excludes recently handled invoices before applying the per-sweep cap, so a backlog drains across
runs.

1. Create the service user, make it ADMIN in the target workspace, and mint an access token.
2. Set the repository variable and secret.
3. Run the workflow with `workflow_dispatch` and confirm the JSON `{ evaluated, run }` response.
4. Check `AutomationRun` rows and the audit entry `automation.run_due`.
5. Enable the hourly schedule (this file enables it; disable the workflow in Actions or remove the
   `schedule` trigger while staging).

### Failure handling

- 401/403: expired or invalid token, or the user is no longer an ADMIN. Mint a new token; deleting
  the membership or user invalidates access on the next request.
- 5xx or network failure: `curl` retries three times. If the API is down, the run fails and GitHub
  notifies according to repository notification settings; rerun manually once healthy. Each rule
  runs in its own transaction, so a failed sweep leaves no partial automation state.
- Slow sweep: candidate lists are capped in `src/lib/automation.ts` and the job times out after five
  minutes. A queued run waits for the in-flight one; do not run parallel workflows against a single
  SQLite instance.

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

## Moving to Postgres

Postgres is not supported by the current image or Compose file; this is the runbook for a deliberate
cutover. Do the whole rehearsal on a branch and a disposable database before touching production.
The application already keeps tenant columns, integer cents, and Zod-validated enums, so most of the
work is migrations, the document-number sequence, and search collation, not a rewrite.

### 1. Provider swap and migrations

1. Take a verified SQLite backup and stop writes.
2. Change `datasource db.provider` to `postgresql` in `apps/api/prisma/schema.prisma` and point
   `DATABASE_URL` at the new server. Keep `relationMode` at its default (foreign keys on).
3. Do not replay `apps/api/prisma/migrations/*`; they contain SQLite SQL (`PRAGMA`, SQLite
   affinities, rewritten tables) that Postgres rejects. On the migration branch, replace the
   migration history with a Postgres baseline generated from the current schema:
   ```bash
   prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma \
     --script --output prisma/migrations/0001_postgres_baseline/migration.sql
   ```
   Keep the SQLite history available on the release tag or branch you would roll back to. Shipping
   SQLite and Postgres from the same commit needs a per-provider schema/migrations path (Prisma
   configuration plus two schema files); this repository has no such setup, so do not claim both
   providers are supported at once until that is added. Subsequent migrations are generated against
   Postgres.
4. Run `prisma migrate deploy` against an empty database and compare the result with
   `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma`.
   The diff must be empty before loading data.

### 2. Data migration

Prisma has no cross-provider data copy. Choose one path and rehearse it:

- Export each table in foreign-key order to CSV/JSON with a small script, load with Postgres `COPY`,
  then reset sequences. Disable or defer constraints during the load and re-enable them before
  validation.
- Or use `pgloader` against a SQLite dump for the bulk load, then verify types and defaults.
- Copy `DocumentCounter` rows as-is; do not recompute document numbers after loading jobs,
  estimates, and invoices.

JSON is stored as text today (`AutomationRule.conditions`, `AutomationRule.actions`, tags). Keep it as
text for a provider swap, or convert to `jsonb` in a separate, deliberate migration: Prisma would
then return parsed values and every `JSON.parse`/`JSON.stringify` call would need review. All dates
move as UTC timestamps; money stays integer cents.

### 3. SQLite-specific assumptions to replace

- **Pragmas.** `configureDatabase()` runs `PRAGMA journal_mode=WAL`, `busy_timeout`, and
  `foreign_keys`. These are SQLite-only; guard the call by provider or remove it for Postgres.
  Prisma enables foreign keys for Postgres connections.
- **Document numbering.** The in-process per-workspace promise queue and the `P2002`/`P2010`/
  `P2034`/`P2028`/"database is locked" retry classifier exist because SQLite has one writer. With
  multiple API instances the queue no longer serializes anything: move allocation to a Postgres
  sequence per prefix or `SELECT ... FOR UPDATE` on `DocumentCounter`, and add `40001`/`40P01`
  serialization retries. Until that is done, keep one API instance even on Postgres.
- **Search.** SQLite `LIKE` is case-insensitive for ASCII; Postgres `LIKE` is case-sensitive.
  `likeTerm()` currently passes `%`/`_` through as wildcards, so re-check every `contains` filter and
  add Prisma `mode: "insensitive"` (or an `ILIKE`/`citext`/trigram decision) to preserve search
  behavior. Index the columns those filters use.
- **Ordering.** Timestamp ties are less likely on Postgres, but keep the explicit `id` tiebreaker so
  pagination stays stable.
- **Types.** Prisma maps `Boolean` to native Postgres booleans and strings-as-enums stay text unless
  you deliberately add native enums. Both are fine; the API boundary already validates values with
  Zod.
- **Health check.** `SELECT 1` is portable; no change is needed.

### 4. Schema and index review

- Every tenant list path must filter on `workspaceId` and have a matching `(workspaceId, ...)`
  index. The schema already indexes the CRM, service, finance, inbox, and automation lists; new
  queries added during the cutover need the same treatment.
- Run `EXPLAIN (ANALYZE, BUFFERS)` for the dashboard, finance summary, dispatch board, and
  automation sweep queries. Look for sequential scans on the large tables (`Communication`,
  `AutomationRun`, `Payment`, `Activity`) and add composite indexes in a new migration if needed.
- `jsonb` GIN and trigram indexes are Postgres-only, and partial indexes need provider-specific
  migration SQL rather than Prisma schema attributes. Introducing any of them requires
  provider-specific migrations, so keep the shared schema provider-neutral unless you are committing
  to Postgres.

### 5. Cutover

1. Freeze writes: stop the API, take a final SQLite backup, and record row counts.
2. Load data, then run the validation checklist below against the Postgres database.
3. Set `DATABASE_URL` on the deployment, start one API instance, and check `/api/v1/health`.
4. Smoke-test login, tenancy, invoice payment, document creation, the automation sweep, and search.
5. Only after the sequence change and validation, scale to more than one instance.

### 6. Rollback

Point `DATABASE_URL` back to the untouched SQLite file and start the previous image. Keep the SQLite
volume read-only or backed up from the moment of cutover: writes made to Postgres after the switch
are not replayed back, and there is no dual-write mode. Revert the Prisma provider and migration
directory in the same commit that introduced them.

### 7. Validation checklist

- `prisma migrate deploy` completes on an empty database and the schema diff is empty.
- Row counts match per table; `Invoice.amountPaid` equals the sum of its `Payment` rows.
- Document counters continue without collisions or reused numbers.
- Login, refresh rotation, role checks, cross-tenant 404s, and the audit log behave correctly.
- `POST /automations/run-due` is idempotent across two consecutive calls.
- Search results match the SQLite behavior for case and wildcard terms.
- List pagination does not skip or repeat rows with tied timestamps.
- `pg_dump`/`pg_restore` restore drill succeeds, and the backup job replaces the SQLite scripts.
- Logs show no pragma, lock-retry, or connection-pool errors.
