# Meridian CRM — Release Status

**Version:** 0.2.0 (service-provider suite) · **Date:** 2026-11-11 · **Repository:** public,
proprietary [`StinkyCat0/meridiancrm`](https://github.com/StinkyCat0/meridiancrm)

## Running now

| Surface  | URL                                 | Notes             |
| -------- | ----------------------------------- | ----------------- |
| Web app  | http://localhost:5173               | Vite dev server   |
| API      | http://localhost:4000/api/v1        | Fastify           |
| API docs | http://localhost:4000/docs          | OpenAPI 3.0       |
| Health   | http://localhost:4000/api/v1/health | includes DB check |

Demo workspace: **Meridian Home Services** (slug `meridian-studio`), seeded as an Austin, TX
home-services book. Password for all seeded accounts is `Meridian2026!`.

| Account                  | Role   | Purpose                    |
| ------------------------ | ------ | -------------------------- |
| `demo@meridian.studio`   | OWNER  | full workspace walkthrough |
| `member@meridian.studio` | ADMIN  | admin-gated surfaces       |
| `maya@meridian.studio`   | MEMBER | member-level checks        |

The seed also creates `chris@` and `sofia@` as MEMBER accounts, plus customers, locations, jobs,
estimates, invoices, payments, expenses, logged communications, and automation rules.

## Shipped surface

- Auth with short-lived JWTs, rotating httpOnly refresh cookies, scrypt hashing, invites, password
  change, and audited workspace administration.
- Multi-tenant workspaces with OWNER/ADMIN/MEMBER enforcement re-read per request.
- CRM: customers, contacts, deals with archive/restore, tags, configurable pipelines, stage history,
  drag-and-drop board, and explainable momentum with a breakdown.
- Service operations: locations with one primary per customer, price book with cost, jobs with a
  single transition table, estimates with atomic conversion, invoices with a payment ledger.
- Dispatch: daily board with utilization, OpenStreetMap stop map, per-technician optimized route,
  bulk assignment with schedule-conflict checks.
- Local inbox: logged calls/texts/emails, per-customer threads, stats, unread state, and
  deterministic message drafts. No carrier or mailbox is connected.
- Customer 360 timeline across activities, communications, jobs, estimates, invoices, and payments.
- Automations: nine triggers, conditions, four contained action types, run history, 24-hour dedupe,
  admin-triggered due sweep.
- Finance: summary, payment ledger list, expense CRUD, margins, monthly trends, category spend,
  technician revenue, and top customers.
- Intelligence: local recommendations, forecast, health, upsells, and assistant brief.
- Team performance and workload with utilization, ratings, revenue, and margin.
- Operations dashboard, dashboard analytics, global search, ⌘K/Ctrl+K palette, settings, audit,
  installable PWA, and documented REST API.

## Verification evidence

Verified on branch `feat/service-provider-suite`:

- **API integration tests:** 90 passing across auth, CRM, service operations, communications,
  dispatch, finance, automations, intelligence, and team suites.
- **Contract tests:** 17 passing (momentum, formatters, route optimization, message drafts, invoice
  rules, scoring).
- **Typechecks:** `npm run typecheck` clean for API and web, run sequentially as CI does.
- **Builds:** `@meridian/api` (`tsup`) and `@meridian/web` (`vite build`) both succeed.
- **Coverage:** `npm run test:coverage` satisfies the configured floor (statements 20, branches 15,
  functions 20, lines 20).
- **Formatting:** Prettier check clean across the repository.

CI runs these same gates on every pull request: format check, Prisma client generation and
migrations, contracts tests, API tests with coverage, sequential API then web typechecks, both
builds, and artifact upload. Separate workflows run CodeQL `security-extended` and Dependency Review
(failing new high-severity dependencies); the Verify job also audits production dependencies at
critical severity.

## Known limits (current)

- **No carrier or mailbox.** Communications are recorded locally; nothing is delivered or received.
  "Sent" is local bookkeeping.
- **No external LLM.** Drafts and intelligence are deterministic local engines; they do not call a
  model provider and cannot reason beyond their encoded rules.
- **No file uploads.** Expenses accept an optional receipt URL only.
- **SQLite is single-writer.** WAL, a 5-second busy timeout, and an in-process per-workspace
  document-write queue keep one instance reliable. Multi-instance deployment needs Postgres.
- **No native app.** The responsive, installable PWA is the mobile surface today.
- **OpenStreetMap tile dependency.** The dispatch map loads tiles directly from
  `tile.openstreetmap.org` in the browser, with no API key, proxy, or offline cache. Tile requests
  disclose the browser IP to OSM; if tiles fail, stops still render without a basemap.
- **Payments are a ledger.** Meridian records receipts and adjustments; it is not a payment
  processor.
- No email delivery for invites or password resets; invite links are copied manually.
- No billing, SSO/SAML, MFA, or reporting exports yet.
- One workspace per account at a time.

## Next

1. Add a carrier/mailbox integration and a scheduled automation worker.
2. Add Postgres when more than one app instance is needed.
3. Add file storage for receipts and exports.
4. Deploy behind TLS (Caddy example in [DEPLOYMENT.md](DEPLOYMENT.md)) and point the optional health
   worker at it.
5. Start the Expo client from [MOBILE.md](MOBILE.md) using `packages/contracts` and
   `packages/api-client`.
