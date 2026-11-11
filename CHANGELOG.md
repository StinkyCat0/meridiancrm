# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to semantic versioning for public contracts.

## [Unreleased]

### Added

- Service-business model: customers are typed `RESIDENTIAL`, `COMMERCIAL`, or `PROPERTY_MANAGER`
  and carry an email plus location and open-job counts.
- Service locations with access notes, gate codes, on-site contacts, archive/restore and a single
  primary location per customer.
- Service price book with categories, units, duration, price in cents, taxable flags and usage
  counts.
- Jobs / work orders with per-workspace numbers (`JOB-1001`), scheduling windows, priority,
  assignee, recurrence, line items, tax, deposits, and an arrival/completion lifecycle.
- Estimates (`EST-1001`) with draft → sent → approved flow and conversion into a job that preserves
  line items and totals.
- Invoices (`INV-1001`) generated from a job or customer, with partial payments, derived balances
  and overdue flags.
- `/ops/summary` operations dashboard aggregate, plus global search hits for jobs, locations,
  estimates and invoices.
- API integration tests covering locations, price book, jobs, estimates, invoices, ops summary,
  search and tenant isolation.
- Prisma migration and a demo seed built around home-service customers.

### Fixed

- Estimate-to-job conversion is atomic: concurrent converts can no longer create two jobs for one
  estimate, and the losing request gets a 409.
- Location search hits link to the company detail route instead of a removed `/app/customers` path.
- Fresh installs no longer leave `@prisma/client` ungenerated: `db:setup`, `dev`, and `build`
  generate it, so the documented quickstart can sign in with the demo account.
- Non-JSON API responses (for example, a Vite proxy error while the API is down) now report that
  the API may be unreachable instead of surfacing a bare `Internal Server Error`.

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

[Unreleased]: https://github.com/StinkyCat0/meridiancrm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/StinkyCat0/meridiancrm/releases/tag/v0.1.0
