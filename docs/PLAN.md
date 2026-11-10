# Meridian CRM — Build Plan

> Internal execution plan. Update status as phases close. One source of truth for scope.

## Vision fit

Meridian Studios sells **precision, aesthetics, performance** (meridianstudios.org). Meridian CRM is the
studio's first product: a boutique CRM that feels like the studio's sites — dark, exact, fast — and is
API-first so it can become an iOS/Android app without a rewrite.

## MVP definition (industry-standard bar)

A user can sign up, belong to a workspace, manage companies/contacts, run a deal pipeline with stages,
log activities/tasks, see a revenue dashboard with real analytics, search everything, manage the team,
and consume the same capabilities over a documented REST API. Data persists. Roles are enforced.

### Must-have checklist (all required for "done")

- [ ] Monorepo, CI, Docker, one-command local run, seeded demo workspace.
- [ ] Auth: register (creates workspace), login, refresh (httpOnly cookie), logout, me, password hashing.
- [ ] Multi-tenant workspaces with OWNER/ADMIN/MEMBER roles enforced server-side.
- [ ] CRUD + list/search/filter/pagination/sort for companies, contacts, deals, activities.
- [ ] Pipelines & configurable stages; deal stage moves recorded in stage history.
- [ ] Deal "momentum" score (deterministic, documented) — product differentiator.
- [ ] Dashboard: pipeline value, won ARR/this month, win rate, avg deal size, stage distribution,
      revenue trend, activity mix, recent deals.
- [ ] Global search endpoint + ⌘K command palette.
- [ ] Team management: members, invites (token, expiry), role changes, remove.
- [ ] Audit log for privileged/mutating actions (admin view).
- [ ] REST API documented (OpenAPI + interactive docs), consistent errors, rate limits, validation.
- [ ] Responsive, accessible, keyboard-first dark UX with loading/empty/error states.
- [ ] PWA installable; architecture doc for Expo/React Native port; shared contracts + typed client.
- [ ] Tests: API integration (auth, tenancy, CRUD, pipeline), contract/unit tests; all green.
- [ ] README screenshots-ready quickstart; SECURITY, CHANGELOG, LICENSE (proprietary).

### Explicit non-goals (documented as roadmap)

Email sync/IMAP, billing/Stripe, workflows automation builder, mobile native build, SSO/SAML,
file uploads, reporting exports. These are v1.1+ and must not silently creep into MVP.

## Architecture (decided)

- **Monorepo** npm workspaces: `apps/api` (Fastify), `apps/web` (React+Vite), `packages/contracts`
  (Zod schemas + shared types + momentum util), `packages/api-client` (typed fetch client).
- **DB**: SQLite via Prisma (single-machine deploy now; Postgres is a provider swap, no app rewrite).
- **Auth**: short-lived JWT access token (Bearer), rotating opaque refresh token hashed at rest,
  delivered as httpOnly SameSite=Lax cookie. Scrypt (node:crypto) password hashing, zero native deps.
- **API**: `/api/v1`, JSON, cursor-free offset pagination `{ data, meta }`, error envelope
  `{ error: { code, message, details? } }`, Zod validation, OpenAPI 3.1, rate limiting, CORS allowlist.
- **Web**: React 19 + Vite + Tailwind v4 + TanStack Query + React Router + dnd-kit + Recharts.
  Design tokens in one CSS file. No component library — the aesthetic is the product.
- **Mobile portability**: all network access through `packages/api-client`; no DOM-only business logic;
  responsive layouts; PWA; `docs/MOBILE.md` maps each screen to React Native primitives.

## Phases

| # | Phase | Owner | Exit criteria |
|---|-------|-------|---------------|
| 0 | Foundations | orchestrator | repo, workspace configs, contracts, Prisma schema, plan docs, git + remote |
| 1 | Parallel build | subagents: API core+CRM, web shell+auth, devops/docs | packages build; server boots; shell renders login |
| 2 | Feature surface | subagents: contacts/companies, deals/kanban, dashboard/activities/settings | routes implemented against live API |
| 3 | Hardening | orchestrator + fix-up agents | integration tests green, UX verified in browser, a11y pass |
| 4 | Release | orchestrator | CI green config, Docker build, README, commit + push, app running locally |

## Verified commands (avoid expensive full-tree typechecks)

- API tests: `npm test -w @meridian/api` (Vitest, fastify.inject)
- Web build: `npm run build -w @meridian/web` (Vite/esbuild)
- API build: `npm run build -w @meridian/api` (tsup/esbuild)
- Typecheck only when needed, per package: `npx tsc -p apps/api --noEmit`
- Full `npm run verify` = contracts test + api test + builds. CI runs it once.

## Product decisions

- Repo: **private** (commercial product; deployment is local/Docker today).
- Demo account: `demo@meridian.studio` / `Meridian2026!` (seeded, clearly labeled demo).
- Currency: USD by default, workspace-configurable string; amounts stored as integer cents.
- Deletion: companies/contacts/deals support archive (soft) + restore; hard delete admin-only.
- Momentum score: 0–100 from activity recency, stage age vs typical, close-date pressure. Shown as
  a "signal" bar, not a black box: breakdown exposed in API.
