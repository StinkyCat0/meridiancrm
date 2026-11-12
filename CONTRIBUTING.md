# Contributing

Meridian CRM is a public repository with a proprietary license. The source is available for
review; using, modifying, or redistributing it requires the terms in [LICENSE](LICENSE).
Contributions are accepted by maintainer approval only.

## Setup

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run db:setup
npm run dev
```

Node.js 22+ and npm 10+. The API runs on port 4000, the web app on 5173. API docs are at
http://localhost:4000/docs. Generate a real `JWT_SECRET` for anything beyond local development:

```bash
openssl rand -base64 48
```

## Scripts

| Command                 | Use                                                         |
| ----------------------- | ----------------------------------------------------------- |
| `npm run dev`           | API + web watch mode.                                       |
| `npm run build`         | Production builds for API and web.                          |
| `npm test`              | Contracts tests plus API integration tests.                 |
| `npm run test:coverage` | Contracts tests plus API tests with the coverage gate.      |
| `npm run verify`        | Tests + both builds.                                        |
| `npm run verify:ci`     | Format check, coverage tests, both typechecks, both builds. |
| `npm run typecheck`     | TypeScript across API and web.                              |
| `npm run format`        | Prettier write.                                             |
| `npm run format:check`  | Prettier check; CI fails on unformatted files.              |
| `npm run db:setup`      | Generate the client, migrate, and seed the demo workspace.  |

`verify:ci` is the closest local equivalent of the Verify job. CI runs the individual steps in
order, including Prisma client generation and migrations before the tests.

## Branch and PR flow

1. Branch from `main`: `feat/<topic>`, `fix/<topic>`, or `docs/<topic>`.
2. Keep commits focused; imperative subject, body explains the why.
3. Open a pull request against `main`. All required checks below must pass.
4. One reviewer for code changes; docs-only changes may merge after CI.
5. Squash merge. Do not force-push shared branches.

## Required checks

- **Format:** `npm run format:check` (Prettier across TS, TSX, CSS, Markdown, and JSON).
- **Contracts:** `npm run test -w @meridian/contracts` (momentum, formatters, invoice rules, route
  optimization, drafts, scoring).
- **API tests with coverage:** `npm run test:coverage -w @meridian/api`. The suite uses a disposable
  SQLite database and must satisfy the configured floor (statements 20, branches 15, functions 20,
  lines 20). Do not lower the thresholds to merge.
- **Typechecks:** `npm run typecheck -w @meridian/api` then `-w @meridian/web`, run sequentially.
  Each pulls in the whole package graph; running them together on a small runner thrashes memory.
- **Builds:** `npm run build -w @meridian/api` and `-w @meridian/web`.
- **CodeQL:** the `CodeQL` workflow analyzes JavaScript/TypeScript with `security-extended` on pull
  requests, pushes to `main`, and a weekly schedule.
- **Dependency Review:** pull requests introducing high-severity vulnerable dependencies fail and
  receive a summary comment.
- **Production audit:** `npm audit --omit=dev --audit-level=critical` in the Verify job.
- **CI:** the Verify job also uploads the web build and API coverage artifacts.

The current branch verification is 90 API integration tests and 17 contract tests, with both
typechecks and builds passing. Update [docs/STATUS.md](docs/STATUS.md) when those numbers change.

## Review standard

Every PR is reviewed against [docs/REVIEW.md](docs/REVIEW.md). Blocking findings cover tenancy,
auth, validation, data integrity, secrets, and contract drift; should-fix findings cover N+1 queries,
missing indexes, UI states, accessibility, dead code, and test quality. Findings are filed as GitHub
issues with a severity label and must be fixed before merge when blocking. "Out of scope for the
current release" in that document is not permission to add a half-built version of a deferred
feature.

## Code standards

- TypeScript strict mode. No `any` unless it is genuinely external and narrowed immediately.
- Contracts first: define or update the Zod schema and exported type in `packages/contracts` before
  implementing a route or client call. Do not duplicate shapes or status transitions.
- Validate at every boundary; handlers consume parsed input. Keep error codes from
  `ERROR_CODES`/`AppError`.
- Every tenant-owned query includes `workspaceId`. Use `findFirst({ where: { id, workspaceId } })`
  for id lookups, and scope joins (invoice → customer, payment → invoice, automation run → rule).
- Money is integer cents. Status and overdue are derived from shared helpers, never stored twice.
- Document creation goes through `createWithDocumentNumber`; list queries break ties by `id`.
- Domain events are emitted after the writing transaction commits. Automation actions stay inside
  the supported action set and must remain workspace-scoped.
- Web: all network access through `@meridian/api-client`; server state through TanStack Query.
  Prefer existing primitives and design tokens over new one-off styles. Mutations invalidate every
  query family that embeds the changed data.
- No new dependency without a reason in the PR description. Prefer the standard library.

## Tests

- API behavior belongs in `apps/api` integration tests using `fastify.inject`, with a disposable
  database. Cover auth, tenancy, RBAC, validation, status transitions, ledger math, and tenant
  isolation for touched routes.
- Contract helpers (momentum, invoice rules, route optimization, drafts, scoring) are tested in
  `packages/contracts`.
- A bug fix should include a regression test that fails before the fix.
- Suites run serially because SQLite has a single writer; do not enable file parallelism.
- Run `npm test` locally; CI runs the same suites with migrations applied first.

## Secrets

Never commit secrets, tokens, database files, or `.env` contents. Use `.env.example` for new
variables. The repository is public, so assume anything committed is visible forever. If a secret is
committed, rotate it and report it to the maintainer immediately; deleting the commit is not enough.
Report vulnerabilities privately per [SECURITY.md](SECURITY.md), not in a public issue.
