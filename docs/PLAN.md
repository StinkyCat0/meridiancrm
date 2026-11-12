# Meridian CRM — Current Execution Plan

> Current plan for the shipped 0.2.0 service-provider suite. The 0.1.0 MVP build plan is historical
> and has been replaced; see [CHANGELOG.md](../CHANGELOG.md) for what shipped and
> [ROADMAP.md](ROADMAP.md) for what is deliberately deferred.

## Scope

0.2.0 turns the CRM plus basic service operations into a working day for a local service business:
dispatch the morning, log the customer conversation, collect the money, and see which service line
pays. The release is the service suite plus the eight review fixes (#10-#17) that made service
operations consistent.

## Execution order used

1. **Schema** — service-provider records (`Payment`, `Expense`, `Communication`, `AutomationRule`,
   `AutomationRun`, `DocumentCounter`) and the indexes needed by the new list and summary queries.
2. **Contracts** — enums, status machines, invoice rules, drafting, route optimization, finance,
   dispatch, automation, intelligence, team, and timeline shapes.
3. **API libs** — database pragmas and write serialization, job transition helper, event bus,
   automation engine, intelligence builders, pricing and document-number allocation.
4. **API routes** — service operations, communications, timeline, dispatch, finance, automations,
   intelligence, team, and invoice payment ledger.
5. **Web** — dispatch, calendar, inbox, revenue, automations, intelligence, and team surfaces; list
   pagination; query invalidation and error states.
6. **Review fixes** — invoice state, job status paths, overdue balance, numbering and ordering,
   primary-location invariant, seed/tax polish.
7. **Gates and docs** — format check, contracts tests, API coverage, sequential typechecks, builds,
   CodeQL, a critical production-dependency audit, and this documentation set.

## Verification plan

Run from the repository root on a clean database:

```bash
npm run format:check
npm run test -w @meridian/contracts
npm run test:coverage -w @meridian/api
npm run typecheck -w @meridian/api
npm run typecheck -w @meridian/web
npm run build -w @meridian/api
npm run build -w @meridian/web
```

`npm run verify:ci` runs the format check, coverage tests, both typechecks, and both builds in one
command; CI runs the same steps with Prisma generation and migrations first. The API suite uses a
disposable SQLite file and `fileParallelism: false` / `singleFork: true`, matching the single-writer
constraint.

Acceptance for the branch:

- 90 API integration tests and 17 contract tests pass.
- Coverage meets the configured floor: statements 20, branches 15, functions 20, lines 20.
- API and web typechecks pass in sequence.
- API and web production builds succeed.
- Prettier check is clean.
- Endpoint names, roles, and status machines in [API.md](API.md) match the route code and
  `packages/contracts`.

## Deliberately deferred

Carrier/mailbox integration, a scheduled automation worker, an external model, file uploads,
Postgres/multi-instance deployment, payment processing, reporting exports, billing, SSO/MFA, and a
native app. See [ROADMAP.md](ROADMAP.md) for dependencies and sequencing.
