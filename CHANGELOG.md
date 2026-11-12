# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to semantic versioning for public contracts.

## [0.2.0] - 2026-11-11

Service-provider suite: dispatch, a local inbox, automations, finance and margins, intelligence,
team performance, a payment ledger, and the review fixes that make the service operations
consistent.

### Added

- Service-business model: customers are typed `RESIDENTIAL`, `COMMERCIAL`, or `PROPERTY_MANAGER`
  and carry an email plus location and open-job counts.
- Service locations with access notes, gate codes, on-site contacts, coordinates, archive/restore,
  and a single primary location per customer, enforced under concurrent writes.
- Service price book with categories, units, duration, price in cents, cost, taxable flags, and
  usage counts.
- Jobs / work orders with per-workspace numbers (`JOB-1001`), scheduling windows, priority,
  assignee, recurrence, line items, tax, deposits, ratings, and an arrival/completion lifecycle
  including `NO_SHOW`.
- Estimates (`EST-1001`) with a draft → sent → approved flow and conversion into a job that
  preserves line items and totals.
- Invoices (`INV-1001`) generated from a job or customer, with a payment ledger, derived balances,
  derived status, and overdue flags.
- Dispatch: a daily board grouped by technician with utilization and unassigned work, a map of
  mappable stops, a nearest-neighbour plus 2-opt route per technician, and bulk assign/unassign.
- Communications inbox: logged calls, texts, and emails with channel, direction, intent, sentiment,
  unread state, per-customer threads, inbox stats, notes, and local message drafts.
- Customer timeline merging activities, communications, jobs, estimates, invoices, and payments.
- Automations: rules for nine triggers with conditions and contained actions, plus run history and
  an admin-triggered due sweep for overdue invoices and upcoming appointments.
- Finance: workspace summary (revenue, collected, refunds, invoiced, outstanding, overdue,
  expenses, gross profit and margin, average ticket, monthly trend, category spend, service
  margins, technician revenue, top customers), a payment list, and expense CRUD.
- Intelligence: an explainable recommendation feed, revenue forecast, workspace health, upsell
  opportunities, and an assistant brief, all computed locally.
- Team performance and workload endpoints for jobs, revenue, margin, utilization, ratings, and
  daily capacity.
- `/ops/summary` operations dashboard aggregate, plus global search hits for jobs, locations,
  estimates, and invoices.
- New web surfaces for dispatch, calendar, inbox, revenue, automations, intelligence, and team,
  with a mobile tab bar and expanded command palette.
- API integration tests covering locations, price book, jobs, estimates, invoices, ops summary,
  communications, dispatch, finance, automations, intelligence, team, search, and tenant isolation.
- Prisma migration and a demo seed built around Austin, TX home-service customers with payments,
  expenses, communications, and automation rules.

### Changed

- Job status writes now share one transition table and one side-effect path. `PATCH /jobs/:id` and
  `PATCH /jobs/:id/status` both validate allowed transitions, write the same timeline activity and
  audit row, and emit the same domain event.
- Invoice status defaults are derived from the money with one shared rule set, and explicit status
  transitions are validated. Sending a draft stamps `issuedAt`; leaving `PAID` clears `paidAt`; a
  paid invoice cannot be reopened.
- Invoice `amountPaid` edits and payment endpoints append the matching delta to the `Payment`
  ledger in the same transaction, so the ledger and the invoice total cannot drift.
- Document numbers are allocated from a per-workspace `DocumentCounter` inside the create
  transaction, with retries. Deleted numbers are never reused.
- List queries break ties by `id`, so paginated lists are stable at SQLite's one-second timestamp
  resolution.
- Job, estimate, and invoice list pages now paginate instead of silently truncating at 100 rows;
  detail sublists show their limits.
- Customer and location edits invalidate the queries that embed their names, and failed embedded
  requests render retry states instead of empty states.
- The demo seed derives document amounts from the same pricing and tax helpers as the API, keeps
  draft invoices undated, and asserts that payment totals match `amountPaid` before writing.

### Fixed

- **#10 Invoices:** `PATCH` no longer forces `amountPaid` when a status change does not require it,
  rejects invalid transitions such as `VOID → PAID` and reopening `PAID`, clears `paidAt` on the
  way out of `PAID`, and stamps `issuedAt` when a draft is sent.
- **#11 Jobs:** a single status path removes the divergence between `PATCH /jobs/:id` and
  `PATCH /jobs/:id/status`; canceled and completed jobs can no longer be resurrected or counted
  twice, and `cancelReason` is handled on both routes.
- **#12 Overdue:** overdue is derived from a positive balance, so a fully paid invoice is never
  flagged overdue, and a zero-total invoice cannot be settled by a zero payment.
- **#13 Numbers and ordering:** atomic per-workspace numbering prevents concurrent creates from
  colliding or reusing deleted numbers, list ordering is deterministic, and the missing composite
  indexes are added.
- **#14 Web lists:** jobs, estimates, and invoices paginate with a visible range, matching the
  companies page.
- **#15 Web freshness:** renaming a customer or location refreshes jobs, estimates, invoices,
  locations, and the ops strip; invoice and estimate sublists surface errors; the overdue filter
  narrows rather than replaces the selected status; the ops strip has an error card.
- **#16 Primary location:** the primary flag is written in a transaction that also clears competing
  primaries and promotes a replacement, so two active locations cannot both be primary and clearing
  or archiving the primary either promotes another active location or is rejected. Editing a job
  whose location was archived no longer silently moves it to another site. Customer-only invoices
  fall back to the primary location.
- **#17 Service-ops polish:** seed invoice amounts match job totals, tax math is bounded by the
  contract's line limits, unused `permanent` handling is removed from jobs, an estimate already
  attached to a job cannot be converted again, `OPEN_JOB_STATUSES` is shared, date filters compose
  with the scope, and the seed uses collision-free keys.
- Estimate-to-job conversion is atomic: concurrent converts can no longer create two jobs for one
  estimate, and the losing request gets a 409.
- Location search hits link to the company detail route instead of a removed `/app/customers` path.
- Money fields accept comma decimal separators (`24,99` → $24.99, `1.234,56` → $1,234.56) instead of
  silently multiplying European-style input by 100.
- The job cancellation reason input has an accessible name.
- Fresh installs no longer leave `@prisma/client` ungenerated: `db:setup`, `dev`, and `build`
  generate it, so the documented quickstart can sign in with the demo account.
- Non-JSON API responses (for example, a Vite proxy error while the API is down) now report that
  the API may be unreachable instead of surfacing a bare `Internal Server Error`.

### Security

- Automation actions are contained to workspace-scoped task, communication, and tag writes. An
  automation failure is logged and recorded as a failed run; it never fails the write that emitted
  the event, and one bad rule cannot block its siblings.
- Automation rule mutations and the due sweep require ADMIN; communication deletion requires
  ADMIN. Finance expense mutations require ADMIN; finance reads remain member-readable.
- Every service, dispatch, finance, automation, intelligence, timeline, and team query filters by
  the authenticated workspace. Member lookups for assignment and workload are workspace-scoped.
- The dispatch route requires an assignee who is a member of the caller's workspace.
- Optional receipt URLs are restricted to `http`/`https` without embedded credentials.
- CI adds CodeQL `security-extended`, Dependency Review failing new high-severity dependencies, a
  runtime `npm audit` at critical severity, a coverage floor, and sequential typechecks.
- The repository is public while remaining proprietary; the license grants no rights beyond
  viewing and the terms in `LICENSE`.

## [0.1.0] - 2026-11-10

First MVP release.

### Added

- npm-workspace monorepo: Fastify API, React/Vite web app, shared Zod contracts, typed API client.
- Email/password auth with scrypt hashing, 15-minute access JWTs, rotating httpOnly refresh cookies,
  logout, profile update, and password change.
- Workspace registration, invites with expiring tokens, member roles (OWNER/ADMIN/MEMBER), role
  changes, member removal, and an audit log.
- Companies and contacts: CRUD, tags, owners, archive/restore, permanent delete for admins, search,
  filters, sorting, and pagination.
- Pipelines and configurable stages with ordering, probability, stage kind, and target days.
- Deals: CRUD, stage moves with append-only stage history, won/lost handling, and computed momentum
  score with an exposed breakdown.
- Activities: notes, calls, emails, meetings, and tasks linked to companies, contacts, and deals,
  with due dates and completion.
- Dashboard metrics: pipeline value, won this month, win rate, average deal size, revenue trend,
  stage distribution, activity mix, momentum bands, recent deals, and tasks due.
- Global search and a keyboard-first command palette.
- OpenAPI schema and interactive docs at `/docs`, consistent error envelope, Zod validation, helmet,
  CORS allowlist, rate limiting, request audits.
- Installable PWA with offline shell caching.
- API integration tests, CI workflow, multi-stage Dockerfile, Compose deployment, and an optional
  Cloudflare health worker.
- Documentation: architecture, API, mobile plan, deployment, roadmap, decisions, security, and
  contributing guides.

### Security

- Atomic refresh-token rotation with reuse detection and family revocation.
- Per-route rate limits for register, login, invite acceptance, password change, and refresh;
  trusted-proxy configuration instead of trusting arbitrary `X-Forwarded-For`.
- Fail-closed JWT secret handling: weak/placeholder secrets rejected in production; per-process
  random fallback in development.
- http(s)-only URL validation, SPA CSP, `Cache-Control: no-store` on auth responses, redacted
  invite tokens in request logs.
- Last-owner invariants enforced inside transactions; stage deletion blocked when deal history
  would be orphaned; conditional stage moves prevent duplicate history rows.
- Explicit `COOKIE_SECURE` control for local HTTP vs TLS deployments; loopback Compose binding,
  non-root container, dropped capabilities.

[Unreleased]: https://github.com/StinkyCat0/meridiancrm/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/StinkyCat0/meridiancrm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/StinkyCat0/meridiancrm/releases/tag/v0.1.0
