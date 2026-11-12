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

## ADR-007: A service-provider domain model on top of the CRM

**Context.** The first release modeled sales (companies, deals, pipelines). Local service businesses
need the day of work and the money that follows it: where the customer is, what the visit costs,
who is driving, and what was collected. **Decision.** Keep the CRM records and add a service layer:
customers are typed `RESIDENTIAL`, `COMMERCIAL`, or `PROPERTY_MANAGER`; a customer owns locations
with exactly one primary site; a price book carries price, cost, duration, and taxable flags; jobs
carry scheduling, assignment, recurrence, ratings, and a status machine; estimates convert into
jobs; invoices carry a payment ledger and derived state. Dispatch, finance, team, and intelligence
read this model rather than maintaining parallel copies. **Consequences.** Deals and pipelines still
describe acquisition, while jobs and invoices describe delivery and collection. A customer, location,
and contact are shared by both. The service layer adds a handful of status enums that must stay
validated at the API boundary, and every new list query needs a `(workspaceId, ...)` index.

## ADR-008: Local communications and assistant boundary

**Context.** The product needs an inbox and helpful copy, but the deployment is a single machine
with no provider credentials, deliverability infrastructure, consent flow, or model budget. Shipping
a half-connected mailbox would make "sent" ambiguous and create data-processing obligations.
**Decision.** Treat communications as a local, logged inbox. `POST /communications` writes a
workspace row with `provider: "log"` and no `externalId`; automation messages use
`provider: "automation"`. Message drafts and intelligence are deterministic engines in
`packages/contracts` and `src/lib/intelligence.ts`; no customer data leaves the server and every
draft or recommendation carries its rationale. A stored status of `SENT` means recorded locally, not
delivered. **Consequences.** The inbox is useful for history, dispatch context, and automation
trails, but it cannot send, receive, or reconcile with a carrier. Adding a provider later must keep
the local engine as a fallback, introduce delivery webhooks and consent, and make delivery state
explicit rather than overloading `SENT`.

## ADR-009: Payment ledger with derived invoice state

**Context.** Invoices previously stored a mutable `amountPaid` and derived status ad hoc in two
routes, which let the number and the money drift. **Decision.** `Payment` rows are the ledger. Every
receipt, correction, and adjustment writes a payment row; `Invoice.amountPaid` is a denormalized sum
updated in the same transaction. Derived status — used by the payment endpoints and by `PATCH`
without an explicit status — is a pure function of `amount` and `amountPaid`; explicit status changes
are validated against one transition table in `packages/contracts/src/invoice-rules.ts`. `overdue` is
derived from a positive balance and the due date. Negative deltas are recorded as method
`ADJUSTMENT`. **Consequences.** The invoice page and finance summaries agree, and
`amountPaid` can be rebuilt from the ledger. There is still no double-entry accounting, processor
settlement, refund workflow, or currency conversion; those would need their own records rather than
new meanings for `Payment`.

## ADR-010: SQLite write serialization

**Context.** SQLite is the deployment choice, and it has one writer. Concurrent document creation
previously scanned for a free number outside the transaction, so two requests could pick the same
number, and deleted numbers were reused. SQLite timestamps also tie at one-second resolution, which
made offset pagination unstable. **Decision.** Enable WAL, a 5-second busy timeout, and foreign keys
at boot. Allocate human-readable numbers from a composite-key `DocumentCounter` inside the create
transaction, serialized per workspace by an in-process promise queue and retried on unique/lock
errors. Keep interactive transactions short with explicit wait/timeout limits. Break list-order ties
with `id`. **Consequences.** Single-instance concurrency is fast and deterministic, and numbers are
stable across deletes. The queue is process-local: two API instances would race, so horizontal
scaling requires Postgres (or a shared sequence) first, not merely a bigger SQLite file.

## ADR-011: OpenStreetMap tiles in the browser

**Context.** Dispatch needs a map, and the project has no mapping budget, no geocoding provider, and
no server-side tile cache. **Decision.** Render stops with Leaflet and load standard OpenStreetMap
raster tiles directly from `tile.openstreetmap.org` in the browser. Require no API key, keep the
attribution visible, show a fallback notice when tiles fail, and map only locations that already
have coordinates. Do not geocode addresses or proxy tile traffic. **Consequences.** The map works
without vendor onboarding but depends on a public, rate-limited tile service, and tile requests
disclose the browser's IP address and viewed area to OpenStreetMap. This must be disclosed in the
README, security notes, and any deployment privacy notice. Self-hosted tiles or a commercial provider
would remove the dependency and require an explicit budget/privacy decision.

## ADR-012: Public repository, proprietary license

**Context.** ADR-006 assumed a private repository to protect a commercial product. The repository is
now public for review and portfolio visibility, while the code remains commercially licensed.
**Decision.** Keep the source publicly viewable and keep the all-rights-reserved proprietary
`LICENSE`. Public visibility grants no rights to use, modify, or redistribute beyond viewing and the
license terms. **Consequences.** CI badges render publicly, issue reports and security reports can
come from outside the team, and secret scanning must stay clean because history is visible. This
supersedes only the visibility sentence of ADR-006; the licensing decision stands. Contributions
still require maintainer approval, and security reports should go to the private address rather than
a public issue.
