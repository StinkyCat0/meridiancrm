# Contributing

Internal project. The repository is private; access is granted per contributor.

## Setup

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run db:setup
npm run dev
```

Node.js 20+ and npm 10+. The API runs on port 4000, the web app on 5173. API docs are at
http://localhost:4000/docs. Generate a real `JWT_SECRET` for anything beyond local development:

```bash
openssl rand -base64 48
```

## Scripts

| Command             | Use                                                         |
| ------------------- | ----------------------------------------------------------- |
| `npm run dev`       | API + web watch mode.                                       |
| `npm run build`     | Production builds for API and web.                          |
| `npm test`          | API integration tests.                                      |
| `npm run verify`    | Tests + both builds. Run before opening a PR.               |
| `npm run typecheck` | TypeScript across both apps.                                |
| `npm run db:setup`  | Migrations + demo seed.                                     |
| `npm run format`    | Prettier.                                                   |

## Branch and PR flow

1. Branch from `main`: `feat/<topic>`, `fix/<topic>`, or `docs/<topic>`.
2. Keep commits focused; imperative subject, body explains the why.
3. Open a pull request against `main`. CI must pass (typecheck, tests, builds, web artifact upload).
4. One reviewer for code changes; docs-only changes may merge after CI.
5. Squash merge. Do not force-push shared branches.

## Code standards

- TypeScript strict mode. No `any` unless it is genuinely external and narrowed immediately.
- Contracts first: define or update the Zod schema and exported type in `packages/contracts` before
  implementing a route or client call. Do not duplicate shapes.
- Validate at every boundary; handlers consume parsed input. Keep error codes from
  `ERROR_CODES`/`AppError`.
- Every tenant-owned query includes `workspaceId`. Use `findFirst({ where: { id, workspaceId } })`
  for id lookups.
- Web: all network access through `@meridian/api-client`; server state through TanStack Query.
  Prefer existing primitives and design tokens over new one-off styles.
- No new dependency without a reason in the PR description. Prefer the standard library.
- Formatting is Prettier; do not reformat unrelated files.

## Tests

- API behavior belongs in `apps/api` integration tests using `fastify.inject`, with a disposable
  database. Cover auth, tenancy, RBAC, CRUD, and stage transitions for touched routes.
- Contract helpers (momentum, enums) are tested in `packages/contracts`.
- A bug fix should include a regression test. Run `npm test` locally; CI runs it with no database
  browser or Docker dependency.

## Secrets

Never commit secrets, tokens, database files, or `.env` contents. Use `.env.example` for new
variables. If a secret is committed, rotate it and report it to the maintainer immediately; deleting
the commit is not enough.
