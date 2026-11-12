# Meridian CRM — Release Status

**Version:** 0.1.0 (MVP) · **Date:** 2026-11-10 · **Repository:** private
[`StinkyCat0/meridiancrm`](https://github.com/StinkyCat0/meridiancrm)

## Running now

| Surface  | URL                                 | Notes             |
| -------- | ----------------------------------- | ----------------- |
| Web app  | http://localhost:5173               | Vite dev server   |
| API      | http://localhost:4000/api/v1        | Fastify           |
| API docs | http://localhost:4000/docs          | OpenAPI 3.0       |
| Health   | http://localhost:4000/api/v1/health | includes DB check |

Demo workspace: **Meridian Studio** — `demo@meridian.studio` / `Meridian2026!` (OWNER).
Second seeded account: `member@meridian.studio` / `Meridian2026!` (MEMBER, for role checks).

## Shipped surface

- Auth with short-lived JWTs, rotating httpOnly refresh cookies, scrypt hashing, invites, password change.
- Multi-tenant workspaces with OWNER/ADMIN/MEMBER enforcement re-read per request, audit log.
- Companies, contacts, deals with archive/restore, tags, ownership, search, filters, pagination.
- Configurable pipelines/stages, drag-and-drop board, stage history, won/lost reconciliation.
- Explainable 0–100 momentum score on every deal, with breakdown.
- Activities (note/call/email/meeting/task), due grouping, completion, linked records.
- Dashboard: pipeline value, wins, win rate, average deal, revenue trend, stage distribution,
  activity mix, momentum bands, recent deals, tasks due.
- Global ⌘K/Ctrl+K palette and REST search.
- Settings: profile, password, workspace, members/roles, invites, pipeline stage admin, audit.
- Installable PWA; typed API client and shared Zod contracts for a future native client.

## Verification evidence

- Contracts tests: 6/6. API integration tests: 14/14 (auth, refresh reuse, invites, tenancy, RBAC,
  CRUD, stage transitions, stage integrity, dashboard, search).
- `npm run typecheck` clean across API, web, contracts; `npm run build` succeeds for both apps.
- Chromium walkthrough at 1440px and 390px: login, dashboard, contacts (created a record), companies,
  deals board and `?deal=` deep link, activities, settings, command palette; zero console errors.
- Production single-container mode: SPA fallback, CSP, immutable hashed assets, missing asset 404,
  `Cache-Control: no-store` on auth, HttpOnly/SameSite refresh cookie.
- GitHub Actions `Verify` job: automatic run on `main`; manual dispatch verified on the release branch.

## Known limits (intentional for MVP)

- SQLite is single-writer; multi-instance deployment needs Postgres (provider swap, no API rewrite).
  MongoDB is not a fit for the relational pipeline model and remains a later evaluation only.
- No email delivery: invite links are returned to the admin to share; no password-reset email flow.
- No billing, SSO/MFA, automation builder, file uploads, or native mobile build yet.
- One workspace per account at a time (invite acceptance is for new accounts).
- Docker image not built in this environment (no Docker daemon); config is committed and documented.
- Cloudflare health worker is committed but not deployed (no Cloudflare credentials).

## Next

1. Deploy behind TLS (Caddy example in `docs/DEPLOYMENT.md`) and point the health worker at it.
2. Add email delivery for invites and password resets.
3. Add Postgres when more than one app instance is needed.
4. Start the Expo client from `docs/MOBILE.md` using `packages/contracts` and `packages/api-client`.
5. Add email-logging sync and a reporting/export surface.
