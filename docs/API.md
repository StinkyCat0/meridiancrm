# API reference

Base URL: `http://localhost:4000/api/v1` in development, `https://<your-host>/api/v1` in production.
All bodies are JSON. Interactive documentation is served at `/docs`; the OpenAPI document is at
`/docs/json`.

Amounts are integer cents. Dates are ISO 8601 strings. Ids are cuid strings.

## Authentication

Access tokens are bearer JWTs valid for 15 minutes. Refresh tokens are opaque, rotated on use, and
delivered as an httpOnly cookie scoped to `/api/v1/auth`; the cookie is set automatically, so a
browser client only needs `credentials: "include"`.

```bash
# Register creates a user and a workspace, and starts a session (201).
curl -s -c cookies.txt -X POST http://localhost:4000/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"Analytical1","workspaceName":"Analytical Engines"}'

# Login sets the refresh cookie (200).
curl -s -c cookies.txt -X POST http://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"Analytical1"}'

# Use the returned accessToken on protected routes.
curl -s http://localhost:4000/api/v1/auth/me \
  -H "authorization: Bearer $ACCESS_TOKEN"

# Rotate the refresh cookie and get a new access token (200).
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:4000/api/v1/auth/refresh

# Logout revokes the refresh token and clears the cookie (204).
curl -s -b cookies.txt -X POST http://localhost:4000/api/v1/auth/logout
```

The login response and the register/accepted-invite responses are a session:

```json
{
  "accessToken": "<jwt>",
  "expiresIn": 900,
  "user": {
    "id": "…",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "avatarUrl": null
  },
  "workspace": {
    "id": "…",
    "name": "Analytical Engines",
    "slug": "analytical-engines",
    "currency": "USD",
    "createdAt": "…"
  },
  "role": "OWNER"
}
```

`POST /auth/refresh` returns `{ "accessToken": "…", "expiresIn": 900 }` only. A 401 means the session
is gone: clear local state and send the user to login.

## Pagination, filtering, sorting

List endpoints accept:

| Query      | Default | Notes                                                       |
| ---------- | ------- | ----------------------------------------------------------- |
| `page`     | `1`     | 1-10000.                                                    |
| `pageSize` | `25`    | 1-100.                                                      |
| `q`        | none    | Case-insensitive substring search over documented fields.   |
| `sort`     | varies  | Endpoint-specific; unknown values fall back to the default. |
| `order`    | `desc`  | `asc` or `desc`.                                            |

Responses are `{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }`. Endpoint-
specific filters are listed below. Endpoints that are not paginated — threads, stats, drafts,
customer timeline, dispatch, finance summary, intelligence, team reports, and an invoice's payment
list — return their documented object or array directly.

## Errors

Every non-2xx JSON response uses one envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields",
    "details": { "fieldErrors": {}, "formErrors": [] }
  }
}
```

| Status | Codes                             |
| ------ | --------------------------------- |
| 400    | `BAD_REQUEST`, `VALIDATION_ERROR` |
| 401    | `UNAUTHORIZED`                    |
| 403    | `FORBIDDEN`                       |
| 404    | `NOT_FOUND`                       |
| 409    | `CONFLICT`                        |
| 429    | `RATE_LIMITED`                    |
| 500    | `INTERNAL`                        |

`details` is optional and currently carries Zod field errors for validation failures.

## Endpoints

### Auth

| Method | Path                  | Auth   | Purpose                                                                                                                       |
| ------ | --------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/register`      | no     | Create user + workspace, start session (201).                                                                                 |
| POST   | `/auth/login`         | no     | Start session (200). Rate limited to 10/minute per client.                                                                    |
| POST   | `/auth/refresh`       | cookie | Rotate refresh token, return new access token.                                                                                |
| POST   | `/auth/logout`        | cookie | Revoke refresh token, clear cookie (204).                                                                                     |
| GET    | `/auth/me`            | yes    | Current user, workspace, role, and member count.                                                                              |
| PATCH  | `/auth/me`            | yes    | Update `name` and/or `avatarUrl`.                                                                                             |
| POST   | `/auth/password`      | yes    | Change password; revokes active refresh tokens (204).                                                                         |
| GET    | `/auth/invite/:token` | no     | Inspect an invite: email, workspace, role, inviter.                                                                           |
| POST   | `/auth/accept-invite` | no     | Accept invite with token, name, password; start session (201). Password min 10 chars; email must not already have an account. |

### Workspace, members, invites, audit

| Method | Path                     | Role   | Purpose                                                                                                                              |
| ------ | ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/workspace`             | member | Current workspace summary.                                                                                                           |
| PATCH  | `/workspace`             | admin  | Rename workspace or set `currency` (USD, EUR, GBP, CAD, AUD, JPY), `businessType`, `timezone`, `serviceArea`, and depot coordinates. |
| GET    | `/workspace/members`     | member | All members with roles.                                                                                                              |
| PATCH  | `/workspace/members/:id` | admin  | Change role to `ADMIN` or `MEMBER`; owners can only be changed by owners.                                                            |
| DELETE | `/workspace/members/:id` | admin  | Remove a member (204); cannot remove yourself or the last owner.                                                                     |
| GET    | `/workspace/invites`     | admin  | Pending and past invites.                                                                                                            |
| POST   | `/workspace/invites`     | admin  | Invite by email (201); returns `{ invite, token, inviteUrl }`. Token is shown once; 7-day expiry, single use.                        |
| DELETE | `/workspace/invites/:id` | admin  | Revoke an invite (204).                                                                                                              |
| GET    | `/workspace/audit`       | admin  | Paginated audit entries, newest first; `q` matches action/entity.                                                                    |

### Customers (companies)

In the UI and the service model a company is a **customer**. Accounts can be `RESIDENTIAL`,
`COMMERCIAL`, or `PROPERTY_MANAGER`.

| Method | Path                     | Role   | Purpose                                                                                                                                                                 |
| ------ | ------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/companies`             | member | Paginated list. Filters: `archive=active\|archived\|all`, `industry`, `customerType`; `q` matches name, domain, phone or email. Sort: `name`, `updatedAt`, `createdAt`. |
| POST   | `/companies`             | member | Create (201). Accepts `customerType` and `email`. Owner defaults to the caller.                                                                                         |
| GET    | `/companies/:id`         | member | One customer with contact, location and open-job counts, and open pipeline value.                                                                                       |
| PATCH  | `/companies/:id`         | member | Partial update, including archive flag and owner.                                                                                                                       |
| POST   | `/companies/:id/restore` | member | Unarchive.                                                                                                                                                              |
| DELETE | `/companies/:id`         | member | Archive (204). `?permanent=true` requires ADMIN and hard-deletes.                                                                                                       |

### Contacts

| Method | Path                    | Role   | Purpose                                                                                                   |
| ------ | ----------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| GET    | `/contacts`             | member | Paginated list. Filters: `archive`, `companyId`. Sort: `firstName`, `lastName`, `updatedAt`, `createdAt`. |
| POST   | `/contacts`             | member | Create (201).                                                                                             |
| GET    | `/contacts/:id`         | member | One contact with company, last activity, open deal count.                                                 |
| PATCH  | `/contacts/:id`         | member | Partial update.                                                                                           |
| POST   | `/contacts/:id/restore` | member | Unarchive.                                                                                                |
| DELETE | `/contacts/:id`         | member | Archive (204). `?permanent=true` requires ADMIN.                                                          |

### Deals

| Method | Path                 | Role   | Purpose                                                                                                                                                                                                                                                          |
| ------ | -------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/deals`             | member | Paginated list. Filters: `stageId`, `pipelineId`, `ownerId`, `companyId`, `contactId`, `status=open\|won\|lost\|all` (default `all`). Sort: `createdAt`, `value`, `expectedCloseDate`, `updatedAt`. Every deal includes stage, momentum, and relation summaries. |
| POST   | `/deals`             | member | Create (201); writes the first stage-history row.                                                                                                                                                                                                                |
| GET    | `/deals/:id`         | member | One deal with momentum breakdown.                                                                                                                                                                                                                                |
| PATCH  | `/deals/:id`         | member | Partial update; changing `stageId` records stage history.                                                                                                                                                                                                        |
| PATCH  | `/deals/:id/stage`   | member | Move stage with `{ "stageId": "…" }`; records history and audit.                                                                                                                                                                                                 |
| GET    | `/deals/:id/history` | member | Stage history, newest first, with actor.                                                                                                                                                                                                                         |
| DELETE | `/deals/:id`         | admin  | Permanently delete (204).                                                                                                                                                                                                                                        |

Deal values are integer cents. Moving to a `WON`/`LOST` stage sets `closedAt`; moving back to `OPEN`
clears it. `stage.probability` is the stage default, not a per-deal override.

### Pipelines and stages

| Method | Path                            | Role   | Purpose                                                                           |
| ------ | ------------------------------- | ------ | --------------------------------------------------------------------------------- |
| GET    | `/pipelines`                    | member | Pipelines with ordered stages.                                                    |
| POST   | `/pipelines`                    | admin  | Create with default stages (201); first pipeline is default.                      |
| PATCH  | `/pipelines/:id`                | admin  | Rename or set `isDefault`.                                                        |
| POST   | `/pipelines/:id/stages`         | admin  | Append a stage (201): `name`, `probability`, `kind`, `targetDays`.                |
| PATCH  | `/stages/:id`                   | admin  | Update a stage.                                                                   |
| DELETE | `/stages/:id`                   | admin  | Delete a stage (204); rejected if it holds deals or is the pipeline's last stage. |
| POST   | `/pipelines/:id/stages/reorder` | admin  | `{ "stageIds": ["…"] }` must list every stage exactly once; returns the pipeline. |

Stage `kind` is `OPEN`, `WON`, or `LOST`. `targetDays` feeds momentum stage velocity. There is no
pipeline delete endpoint; create additional pipelines instead of deleting.

### Activities

| Method | Path              | Role   | Purpose                                                                                                                                                                                                  |
| ------ | ----------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/activities`     | member | Paginated list. Filters: `type=NOTE\|CALL\|EMAIL\|MEETING\|TASK`, `completed=true\|false`, `due=overdue\|today\|week\|all`, `contactId`, `companyId`, `dealId`. Sort: `dueAt`, `updatedAt`, `createdAt`. |
| POST   | `/activities`     | member | Log an activity (201). Owner is the caller.                                                                                                                                                              |
| PATCH  | `/activities/:id` | member | Update; `completedAt: null` reopens a task.                                                                                                                                                              |
| DELETE | `/activities/:id` | member | Delete (204).                                                                                                                                                                                            |

`due=overdue|today|week` implies incomplete activities only.

### Service locations

| Method | Path                     | Role   | Purpose                                                                                                                   |
| ------ | ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/locations`             | member | Paginated list. Filters: `archive=active\|archived\|all`, `customerId`; sort `label` or `updatedAt`.                      |
| POST   | `/locations`             | member | Add a location to a customer (201).                                                                                       |
| GET    | `/locations/:id`         | member | One location with customer and open-job count.                                                                            |
| PATCH  | `/locations/:id`         | member | Partial update, including `isPrimary` and `archived`.                                                                     |
| POST   | `/locations/:id/restore` | member | Unarchive.                                                                                                                |
| DELETE | `/locations/:id`         | member | Archive (204). `?permanent=true` requires ADMIN and is rejected while jobs, estimates or invoices reference the location. |

Setting `isPrimary` clears the flag on the customer's other locations. Access notes, gate codes and
on-site contact details are returned to members only.

### Service price book

| Method | Path                    | Role   | Purpose                                                                                            |
| ------ | ----------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| GET    | `/services`             | member | Paginated list. Filters: `archive`, `category`, `unit`; sort `name`, `price`, `category`.          |
| POST   | `/services`             | member | Add a service (201). Price is integer cents.                                                       |
| GET    | `/services/:id`         | member | One service with job/estimate usage counts.                                                        |
| PATCH  | `/services/:id`         | member | Partial update.                                                                                    |
| POST   | `/services/:id/restore` | member | Unarchive.                                                                                         |
| DELETE | `/services/:id`         | member | Archive (204). `?permanent=true` requires ADMIN; line items keep their snapshotted name and price. |

Units are `VISIT`, `HOUR`, `SQFT`, `ROOM`, `UNIT`, or `ITEM`.

### Jobs

| Method | Path                  | Role   | Purpose                                                                                                                                                                                             |
| ------ | --------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/jobs`               | member | Paginated list. Filters: `status`, `scope=all\|open\|today\|week\|unscheduled\|upcoming`, `customerId`, `locationId`, `assigneeId`, `from`, `to`, `q`. Sort `scheduledStart`, `total`, `updatedAt`. |
| POST   | `/jobs`               | member | Create a job (201). Numbers start at `JOB-1001`.                                                                                                                                                    |
| GET    | `/jobs/:id`           | member | One job with customer, location, contact, assignee and line items.                                                                                                                                  |
| PATCH  | `/jobs/:id`           | member | Partial update; replacing `lineItems` recalculates totals.                                                                                                                                          |
| PATCH  | `/jobs/:id/status`    | member | Move status; `cancelReason` appends to notes on cancel.                                                                                                                                             |
| POST   | `/jobs/:id/duplicate` | member | Copy a job, optionally at a new `scheduledStart` (201).                                                                                                                                             |
| DELETE | `/jobs/:id`           | admin  | Permanently delete (204).                                                                                                                                                                           |

Statuses are `UNSCHEDULED → SCHEDULED → DISPATCHED → IN_PROGRESS → COMPLETED`, plus `CANCELED`
and `NO_SHOW`. Allowed transitions are enforced, and a no-show can be rebooked to `SCHEDULED`;
completed, canceled, and no-show jobs are otherwise terminal. Moving to `IN_PROGRESS` stamps
`arrivedAt`; `COMPLETED` stamps `completedAt`; `COMPLETED`, `CANCELED`, and `NO_SHOW` also write a
note activity, an audit entry, and a domain event. Supplying `scheduledStart` without
`scheduledEnd` derives the end from `durationMinutes`. `recurrence` is one of `WEEKLY`, `BIWEEKLY`,
`MONTHLY`, `QUARTERLY`, `SEMIANNUAL`, `ANNUAL`.

### Estimates

| Method | Path                     | Role   | Purpose                                                                                    |
| ------ | ------------------------ | ------ | ------------------------------------------------------------------------------------------ |
| GET    | `/estimates`             | member | Paginated list. Filters: `status`, `customerId`, `open=true`. Numbers start at `EST-1001`. |
| POST   | `/estimates`             | member | Create (201).                                                                              |
| GET    | `/estimates/:id`         | member | One estimate with line items and linked job.                                               |
| PATCH  | `/estimates/:id`         | member | Partial update; rejected once converted to a job.                                          |
| PATCH  | `/estimates/:id/status`  | member | `DRAFT`, `SENT`, `APPROVED`, `DECLINED`, `EXPIRED`.                                        |
| POST   | `/estimates/:id/convert` | member | Convert a `SENT` or `APPROVED` estimate into a job (201).                                  |
| DELETE | `/estimates/:id`         | admin  | Delete (204).                                                                              |

Conversion copies line items, tax and totals, links the new job to the estimate, and marks the
estimate `APPROVED`. Converting twice returns 409.

### Invoices

| Method | Path                     | Role   | Purpose                                                                                                                                     |
| ------ | ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/invoices`              | member | Paginated list. Filters: `status`, `customerId`, `jobId`, `overdue=true`; sort `amount`, `dueAt`, `createdAt`. Numbers start at `INV-1001`. |
| POST   | `/invoices`              | member | Create from a `jobId` or a `customerId` (201). From a job, customer, location and amount default to the job.                                |
| GET    | `/invoices/:id`          | member | One invoice with derived `balance` and `overdue`.                                                                                           |
| PATCH  | `/invoices/:id`          | member | Update title, status, amount, `amountPaid`, dates or notes. Status transitions are validated.                                               |
| PATCH  | `/invoices/:id/payment`  | member | Set `amountPaid` to an absolute value; derives `PARTIAL`/`PAID`/`SENT` and appends the delta to the ledger.                                 |
| GET    | `/invoices/:id/payments` | member | List the invoice's payments, newest first.                                                                                                  |
| POST   | `/invoices/:id/payments` | member | Append a payment (`amount`, `method`, `reference`, `receivedAt`) and return the updated invoice (201).                                      |
| DELETE | `/invoices/:id`          | admin  | Delete (204).                                                                                                                               |

`balance = max(0, amount - amountPaid)` and `overdue` is derived from a positive balance and the due
date, never stored. When status is derived — the payment endpoints and `PATCH` without an explicit
status — a draft stays `DRAFT` until money is recorded, then `SENT`, `PARTIAL`, or `PAID` follows the
balance. Explicit status changes are validated against the transition table, and a paid invoice is
terminal. Sending a draft
stamps `issuedAt`; leaving `PAID` clears `paidAt`; a paid invoice cannot be reopened; payments above
the amount are rejected; a zero-total invoice cannot be marked paid.

Payments are a ledger, not a processor. `POST /invoices/:id/payments` inserts a `Payment` row and
raises `amountPaid`; `PATCH /invoices/:id/payment` and `PATCH /invoices/:id` record the difference as
a `Payment` with method `ADJUSTMENT` when it is negative. `method` is one of `CARD`, `CASH`, `CHECK`,
`ACH`, `TRANSFER`, `ADJUSTMENT`, `OTHER`. Creating an invoice already `PAID` records its opening
payment in the same transaction.

### Communications

The inbox is a local log. No carrier, mailbox, or email provider is connected: logging a message
writes a workspace row and does not deliver anything. Rows created by `POST /communications` carry
`provider: "log"`; automation-created messages carry `provider: "automation"`. Both have
`externalId: null`.

| Method | Path                      | Role   | Purpose                                                                                                                               |
| ------ | ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/communications`         | member | Paginated log. Filters: `channel=CALL\|SMS\|EMAIL`, `direction=INBOUND\|OUTBOUND`, `customerId`, `contactId`, `jobId`, `unread`, `q`. |
| GET    | `/communications/threads` | member | Threads grouped by customer, newest first. `q` matches customer name, subject, or body; `limit` 1-100 (default 50).                   |
| GET    | `/communications/stats`   | member | Totals by channel, direction, and unread state, plus calls/texts today and open follow-up tasks.                                      |
| POST   | `/communications/draft`   | member | Build a local message draft. Body: `customerId`, optional `jobId`, `channel`, `intent`, `tone`.                                       |
| GET    | `/communications/:id`     | member | One communication.                                                                                                                    |
| POST   | `/communications`         | member | Log a call, text, or email (201). Requires at least one of `customerId`, `contactId`, `jobId`.                                        |
| PATCH  | `/communications/:id`     | member | Set `readAt` (or clear it) and/or `sentiment`.                                                                                        |
| DELETE | `/communications/:id`     | admin  | Delete the row (204).                                                                                                                 |

`channel` is `CALL`, `SMS`, or `EMAIL`; `direction` is `INBOUND` or `OUTBOUND`; `intent` is one of
`GENERAL`, `REMINDER`, `FOLLOW_UP`, `QUOTE`, `PAYMENT`, `REVIEW`, `WINBACK`, `RESCHEDULE`;
`sentiment` is `POSITIVE`, `NEUTRAL`, or `NEGATIVE`. When `status` is omitted, inbound rows default
to `RECEIVED`, outbound calls to `LOGGED`, and other outbound rows to `SENT`. "Unread" means inbound
with `readAt: null`.

`POST /communications/draft` is deterministic and never calls a model. It composes subject and body
from the customer, first active contact, workspace business type, optional job appointment and
service, and any open balance. The response includes the `rationale` and `tone` (`WARM`,
`PROFESSIONAL`, `BRIEF`). Nothing is stored until the message is logged.

### Customer timeline

| Method | Path                      | Role   | Purpose                                                                                                                 |
| ------ | ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| GET    | `/companies/:id/timeline` | member | Merge activities, communications, jobs, estimates, invoices, and payments for one customer. `limit` 1-200 (default 80). |

The response is `{ customer, items, counts }`, newest first. `items[].kind` is one of `activity`,
`communication`, `job`, `estimate`, `invoice`, `payment`; entries carry a human title, optional
detail, status, amount, `entityId`, and an in-app `href` where one exists. `counts` reports the full
number of each kind even when `items` is truncated by `limit`.

### Operations

| Method | Path           | Role   | Purpose                                                                                                                                                                                                                                                                                           |
| ------ | -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/ops/summary` | member | `?date=YYYY-MM-DD` (defaults to today, UTC). Today's jobs, completed count, unscheduled and unassigned counts, revenue today/week, booked week, outstanding and overdue receivables, active customers, recurring jobs, pipeline value, open estimate count/value, and the next six upcoming jobs. |

Money values are integer cents throughout; `taxRate` is a percentage (for example `8.25`) stored
internally as basis points. Estimate, job and invoice numbers are unique per workspace.

### Dispatch

| Method | Path               | Role   | Purpose                                                                                                                    |
| ------ | ------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/dispatch/board`  | member | Daily board: every member with their jobs, scheduled minutes and utilization (480-minute day), unassigned jobs, and stats. |
| GET    | `/dispatch/map`    | member | Mappable stops for a day with coordinates, `missingLocationCount`, depot, and map center. `assigneeId` narrows the board.  |
| GET    | `/dispatch/route`  | member | Optimized route for one technician. `assigneeId` is required; unknown or non-member ids return 400/404.                    |
| POST   | `/dispatch/assign` | member | Bulk assign or unassign up to 50 jobs. `{ "jobIds": ["…"], "assigneeId": "…" \| null }`.                                   |

`date` defaults to today (UTC); use `YYYY-MM-DD`. Assigning a job moves
`UNSCHEDULED`/`SCHEDULED` work to `DISPATCHED`; unassigning a dispatched job returns it to
`SCHEDULED`. Assignment checks for overlapping schedules on the same technician and returns 409 on a
conflict. The route uses nearest-neighbour ordering plus a bounded 2-opt pass over haversine
distances from the workspace depot (or the first stop when no depot is set); it is a driving
estimate, not live traffic. The map response includes only jobs whose location has coordinates.

### Finance

All finance reads are available to MEMBER. Expense mutations require ADMIN.

| Method | Path                    | Role   | Purpose                                                                                                                            |
| ------ | ----------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/finance/summary`      | member | Revenue, collected, refunds, invoiced, outstanding, overdue amount, expenses, gross profit/margin, average ticket, and breakdowns. |
| GET    | `/finance/payments`     | member | Paginated ledger. Filters: `from`, `to`, `customerId`, `invoiceId`, `q`; sort `receivedAt`, `amount`, `createdAt`.                 |
| GET    | `/finance/expenses`     | member | Paginated expenses. Filters: `category`, `jobId`, `from`, `to`, `q`; sort `incurredAt`, `amount`, `createdAt`.                     |
| POST   | `/finance/expenses`     | admin  | Record an expense (201).                                                                                                           |
| PATCH  | `/finance/expenses/:id` | admin  | Update an expense.                                                                                                                 |
| DELETE | `/finance/expenses/:id` | admin  | Delete an expense (204).                                                                                                           |

`/finance/summary` accepts optional `from` and `to` dates. It defaults to the 90 days ending today
(UTC) and clamps the range to 366 days. The payload includes `monthly` revenue/expenses/profit,
`expensesByCategory`, `serviceMargins` (revenue, cost, margin, margin percent, jobs),
`technicianRevenue`, `topCustomers` (revenue, jobs, open balance), `paymentCount`, and the workspace
`currency`. Revenue and margins come from the payment ledger plus job line-item costs.

Expense fields: `category` (`SUPPLIES`, `FUEL`, `PAYROLL`, `MARKETING`, `SOFTWARE`, `RENT`,
`INSURANCE`, `EQUIPMENT`, `OTHER`), optional `vendor`, `description`, `amount`, `incurredAt`,
optional `jobId`, optional `userId`, and optional `receiptUrl` (http/https only). Referenced jobs and
users must belong to the workspace.

### Automations

| Method | Path                   | Role   | Purpose                                                                                                             |
| ------ | ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| GET    | `/automations`         | member | Paginated rules. Filters: `trigger`, `enabled=true\|false`, `q`; sort `name`, `runCount`, `lastRunAt`, `createdAt`. |
| GET    | `/automations/runs`    | member | Paginated run history, newest first by default. Filters: `trigger`, `status`, `ruleId`.                             |
| POST   | `/automations/run-due` | admin  | Evaluate overdue invoices and jobs in the next 24 hours against enabled rules. Returns `{ evaluated, run }`.        |
| POST   | `/automations`         | admin  | Create a rule (201).                                                                                                |
| GET    | `/automations/:id`     | member | One rule.                                                                                                           |
| PATCH  | `/automations/:id`     | admin  | Update a rule.                                                                                                      |
| DELETE | `/automations/:id`     | admin  | Delete a rule and its run history (204).                                                                            |

Triggers are `JOB_CREATED`, `JOB_COMPLETED`, `JOB_CANCELED`, `JOB_NO_SHOW`, `INVOICE_OVERDUE`,
`QUOTE_SENT`, `QUOTE_APPROVED`, `CUSTOMER_CREATED`, `APPOINTMENT_UPCOMING`. Conditions are optional:
`minTotal` (cents), `customerTypes`, and `priorities`. A rule has 1-5 actions:

- `CREATE_TASK` — `title`, optional `body`, `dueInHours` (default 24).
- `SEND_MESSAGE` — `channel`, `intent`, optional `body`; without a body the local draft engine writes
  one. The result is a logged `Communication` row, not a delivered message.
- `ADD_TAG` — `tag`; skipped when already present.
- `REQUEST_REVIEW` — `channel`; logs a review message and creates a 48-hour follow-up task.

Runs record `SUCCESS`, `SKIPPED`, or `FAILED` with a detail string. The same rule cannot run twice
for the same trigger and entity within 24 hours. Domain events are emitted after the triggering
transaction commits; a failing rule is recorded and isolated from the write and from sibling rules.
`run-due` is idempotent thanks to that dedupe window and only evaluates `SENT`/`PARTIAL` invoices past
due with a balance, plus `SCHEDULED`/`DISPATCHED` jobs starting in the next 24 hours.

### Intelligence

| Method | Path                            | Role   | Purpose                                                                           |
| ------ | ------------------------------- | ------ | --------------------------------------------------------------------------------- |
| GET    | `/intelligence/summary`         | member | Recommendations, counts, forecast, health, and upsells for the workspace.         |
| GET    | `/intelligence/recommendations` | member | Filtered recommendation feed. `kind` narrows the type; `limit` 1-50 (default 20). |
| GET    | `/intelligence/brief`           | member | Plain-language headline, summary, bullets, and the top three focus items.         |

Everything is computed locally from workspace data. No external model, queue, or third-party
enrichment is involved, and every recommendation carries a `rationale`. Kinds are `CHURN_RISK`,
`NO_SHOW_RISK`, `UPSELL`, `COLLECTIONS`, `REVIEW_REQUEST`, `STAFFING`, `REVENUE_FORECAST`,
`QUOTE_FOLLOW_UP`, `ROUTE`; severities are `INFO`, `MEDIUM`, `HIGH`. The forecast reports
`next30Days` with its `scheduled`, `pipelineWeighted`, and `recurring` components, a confidence band,
and the assumptions used. `health` reports churn-risk customers, no-show-risk jobs, overdue amount,
unassigned work today, unbilled jobs, and stale quotes.

### Team

| Method | Path                | Role   | Purpose                                                                                                     |
| ------ | ------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| GET    | `/team/performance` | member | Per-member jobs, revenue, margin, average ticket, utilization, ratings, open jobs, and upcoming minutes.    |
| GET    | `/team/workload`    | member | One day's workload per member: jobs, scheduled minutes, capacity, utilization, next start, completed today. |

`/team/performance` accepts `from`/`to` and defaults to the last 30 days, clamped to 366. It returns
all members, including zero-activity rows, plus workspace totals. Utilization uses weekdays in the
range at 480 minutes per day. Revenue is attributed through the invoice's job assignee; ratings are
averaged from completed jobs when present. `/team/workload` accepts `date` (default today, UTC),
counts all members, and reports unassigned jobs and total scheduled minutes. Capacity is 480 minutes
per member.

### Insights

| Method | Path         | Role   | Purpose                                                                                                                           |
| ------ | ------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/dashboard` | member | Aggregated dashboard summary. `months=3..12` controls the revenue trend window (default 6).                                       |
| GET    | `/search`    | member | `q` (min 2 chars), returns up to 15 hits across contacts, customers, deals, jobs, locations, estimates and invoices with `href`s. |
| GET    | `/health`    | no     | `{ status: "ok"\|"degraded", version, uptime, database }`; 503 when the database is down.                                         |

Dashboard payload includes `pipelineValue`, `openDealCount`, `wonValueThisMonth`, `wonCountThisMonth`,
`winRate` (0-100), `avgDealSize`, `revenueTrend`, `stageDistribution`, `activityMix`, `momentum`
counts, `recentDeals`, `tasksDue`, and the workspace `currency`.

## Tenancy and RBAC

The access token carries the workspace id. Every request re-reads the caller's membership, so role
changes and removals apply immediately. Ids from another workspace return 404, not 403. Roles:

- **MEMBER** — read everything; create/update companies, contacts, deals, activities, jobs,
  estimates, and invoices; log communications; record invoice payments; assign dispatch work; read
  finance summaries, payments, expenses, automations, intelligence, and team reports.
- **ADMIN** — member rights plus workspace settings, invitations, member changes, audit, permanent
  deletion, pipeline/stage management, automation rule changes and the due sweep, expense
  mutations, and communication deletion.
- **OWNER** — admin rights plus authority over other owners. The last owner cannot be removed or
  demoted, and ownership transfer is not exposed.

One workspace per account in this version. Invite acceptance fails if the email already has an
account.

## Rate limits

Global: 600 requests/minute per client, plus stricter per-route limits on auth endpoints (login is
10/minute). Responses include `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`;
excess requests return 429 with `RATE_LIMITED`. The limiter is in-process, so it resets on restart.
Client identity uses forwarded headers only when `TRUST_PROXY` is configured.

## OpenAPI

`GET /docs` is the interactive UI, `GET /docs/json` is the OpenAPI 3.0 document generated from route
schemas. Use it to generate clients; `@meridian/api-client` is written against the same contracts.
