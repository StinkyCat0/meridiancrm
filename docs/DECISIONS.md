# Decisions

Short architecture decision records. Each captures context, the decision, and consequences. They are
not immutable; supersede with a new entry rather than rewriting history.

## ADR-001: SQLite via Prisma for the first release

**Context.** One deployment, modest write volume, no infrastructure budget, and a need for
one-command local setup. **Decision.** SQLite through Prisma, with the schema written provider-
agnostic where practical. **Consequences.** Zero external database to operate; file-level backups;
single-writer limits concurrent writes and rules out horizontal scaling. Postgres is a provider swap
plus migration review, not an application rewrite. Revisit when write contention or multi-instance
deployment appears.

## ADR-002: Short JWT plus rotating opaque refresh cookie

**Context.** The SPA needs stateless authorization without putting long-lived credentials in
JavaScript. **Decision.** 15-minute HS256 access JWT in `Authorization`, plus an opaque 384-bit
refresh token stored only as a SHA-256 hash, delivered as an httpOnly SameSite=Lax cookie scoped to
`/api/v1/auth`, rotated on every refresh and revoked on logout. **Consequences.** No server session
store; logout still works because refresh rows are revocable; CSRF surface is limited by SameSite=Lax
and the narrow cookie path. Native clients need an explicit token path (see `docs/MOBILE.md`).

## ADR-003: Source-exported contracts and API client

**Context.** API, web, and a future native client must agree on shapes; a build step per package
slows the inner loop. **Decision.** `@meridian/contracts` and `@meridian/api-client` export
TypeScript source through their `exports` maps and are consumed directly by Vite and tsup. Zod
schemas define request validation and inferred types. **Consequences.** No stale generated `.d.ts`;
editors navigate straight to source. Packages are private and not published; adding a second consumer
runtime outside the monorepo would require a build/compile step.

## ADR-004: No component library

**Context.** The product's identity is a specific dark, precise studio aesthetic. **Decision.** Build
the UI with Tailwind CSS v4 and a single token file, using small in-repo primitives rather than a
component framework. **Consequences.** Full control of spacing, type, and motion; accessibility and
keyboard behavior must be implemented deliberately (focus rings, dialogs, command palette). No
theme drift from a vendor upgrade, at the cost of owning the primitives.

## ADR-005: PWA first, native later

**Context.** Mobile demand is unproven and the team is small. **Decision.** Ship an installable,
responsive PWA now and keep network access behind `@meridian/api-client` with no DOM-bound business
logic, so an Expo client can reuse contracts and the client. **Consequences.** One codebase for all
devices today; no push notifications, secure native token storage, or offline writes until a native
app exists. The refresh-cookie caveat is documented rather than hidden.

## ADR-006: Private repository, proprietary license

**Context.** Meridian CRM is a commercial studio product, not an open-source project. **Decision.**
Keep the GitHub repository private; license the code as proprietary with an all-rights-reserved
`LICENSE`. **Consequences.** CI badges work on private repositories for authorized viewers; external
contributors need explicit access; no community fork expectations. Revisit only with a deliberate
go-to-market change.
