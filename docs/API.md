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
  "user": { "id": "…", "name": "Ada Lovelace", "email": "ada@example.com", "avatarUrl": null },
  "workspace": { "id": "…", "name": "Analytical Engines", "slug": "analytical-engines", "currency": "USD", "createdAt": "…" },
  "role": "OWNER"
}
```

`POST /auth/refresh` returns `{ "accessToken": "…", "expiresIn": 900 }` only. A 401 means the session
is gone: clear local state and send the user to login.

## Pagination, filtering, sorting

List endpoints accept:

| Query      | Default | Notes                                                               |
| ---------- | ------- | ------------------------------------------------------------------- |
| `page`     | `1`     | 1-10000.                                                            |
| `pageSize` | `25`    | 1-100.                                                              |
| `q`        | none    | Case-insensitive substring search over documented fields.           |
| `sort`     | varies  | Endpoint-specific; unknown values fall back to the default.         |
| `order`    | `desc`  | `asc` or `desc`.                                                    |

Responses are `{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }`. Endpoint-
specific filters are listed below.

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

| Status | Codes                                              |
| ------ | -------------------------------------------------- |
| 400    | `BAD_REQUEST`, `VALIDATION_ERROR`                  |
| 401    | `UNAUTHORIZED`                                     |
| 403    | `FORBIDDEN`                                        |
| 404    | `NOT_FOUND`                                        |
| 409    | `CONFLICT`                                         |
| 429    | `RATE_LIMITED`                                     |
| 500    | `INTERNAL`                                         |

`details` is optional and currently carries Zod field errors for validation failures.

## Endpoints

### Auth

| Method | Path                  | Auth | Purpose                                                      |
| ------ | --------------------- | ---- | ------------------------------------------------------------ |
| POST   | `/auth/register`      | no   | Create user + workspace, start session (201).                |
| POST   | `/auth/login`         | no   | Start session (200). Rate limited to 10/minute per client.   |
| POST   | `/auth/refresh`       | cookie | Rotate refresh token, return new access token.             |
| POST   | `/auth/logout`        | cookie | Revoke refresh token, clear cookie (204).                  |
| GET    | `/auth/me`            | yes  | Current user, workspace, role, and member count.             |
| PATCH  | `/auth/me`            | yes  | Update `name` and/or `avatarUrl`.                            |
| POST   | `/auth/password`      | yes  | Change password; revokes active refresh tokens (204).        |
| GET    | `/auth/invite/:token` | no   | Inspect an invite: email, workspace, role, inviter.          |
| POST   | `/auth/accept-invite` | no   | Accept invite with token, name, password; start session (201). Password min 10 chars; email must not already have an account. |

### Workspace, members, invites, audit

| Method | Path                    | Role   | Purpose                                                              |
| ------ | ----------------------- | ------ | -------------------------------------------------------------------- |
| GET    | `/workspace`            | member | Current workspace summary.                                           |
| PATCH  | `/workspace`            | admin  | Rename workspace or set `currency` (USD, EUR, GBP, CAD, AUD, JPY).   |
| GET    | `/workspace/members`    | member | All members with roles.                                              |
| PATCH  | `/workspace/members/:id`| admin  | Change role to `ADMIN` or `MEMBER`; owners can only be changed by owners. |
| DELETE | `/workspace/members/:id`| admin  | Remove a member (204); cannot remove yourself or the last owner.     |
| GET    | `/workspace/invites`    | admin  | Pending and past invites.                                            |
| POST   | `/workspace/invites`    | admin  | Invite by email (201); returns `{ invite, token, inviteUrl }`. Token is shown once; 7-day expiry, single use. |
| DELETE | `/workspace/invites/:id`| admin  | Revoke an invite (204).                                              |
| GET    | `/workspace/audit`      | admin  | Paginated audit entries, newest first; `q` matches action/entity.    |

### Companies

| Method | Path                  | Role   | Purpose                                                        |
| ------ | --------------------- | ------ | -------------------------------------------------------------- |
| GET    | `/companies`          | member | Paginated list. Filters: `archive=active\|archived\|all`, `industry`. Sort: `name`, `updatedAt`, `createdAt`. |
| POST   | `/companies`          | member | Create (201). Owner defaults to the caller.                    |
| GET    | `/companies/:id`      | member | One company with counts and open pipeline value.               |
| PATCH  | `/companies/:id`      | member | Partial update, including archive flag and owner.              |
| POST   | `/companies/:id/restore` | member | Unarchive.                                                  |
| DELETE | `/companies/:id`      | member | Archive (204). `?permanent=true` requires ADMIN and hard-deletes. |

### Contacts

| Method | Path                   | Role   | Purpose                                                       |
| ------ | ---------------------- | ------ | ------------------------------------------------------------- |
| GET    | `/contacts`            | member | Paginated list. Filters: `archive`, `companyId`. Sort: `firstName`, `lastName`, `updatedAt`, `createdAt`. |
| POST   | `/contacts`            | member | Create (201).                                                 |
| GET    | `/contacts/:id`        | member | One contact with company, last activity, open deal count.     |
| PATCH  | `/contacts/:id`        | member | Partial update.                                               |
| POST   | `/contacts/:id/restore`| member | Unarchive.                                                    |
| DELETE | `/contacts/:id`        | member | Archive (204). `?permanent=true` requires ADMIN.              |

### Deals

| Method | Path                 | Role   | Purpose                                                          |
| ------ | -------------------- | ------ | ---------------------------------------------------------------- |
| GET    | `/deals`             | member | Paginated list. Filters: `stageId`, `pipelineId`, `ownerId`, `companyId`, `contactId`, `status=open\|won\|lost\|all` (default `all`). Sort: `createdAt`, `value`, `expectedCloseDate`, `updatedAt`. Every deal includes stage, momentum, and relation summaries. |
| POST   | `/deals`             | member | Create (201); writes the first stage-history row.                |
| GET    | `/deals/:id`         | member | One deal with momentum breakdown.                                |
| PATCH  | `/deals/:id`         | member | Partial update; changing `stageId` records stage history.        |
| PATCH  | `/deals/:id/stage`   | member | Move stage with `{ "stageId": "…" }`; records history and audit. |
| GET    | `/deals/:id/history` | member | Stage history, newest first, with actor.                          |
| DELETE | `/deals/:id`         | admin  | Permanently delete (204).                                        |

Deal values are integer cents. Moving to a `WON`/`LOST` stage sets `closedAt`; moving back to `OPEN`
clears it. `stage.probability` is the stage default, not a per-deal override.

### Pipelines and stages

| Method | Path                            | Role   | Purpose                                                     |
| ------ | ------------------------------- | ------ | ----------------------------------------------------------- |
| GET    | `/pipelines`                    | member | Pipelines with ordered stages.                              |
| POST   | `/pipelines`                    | admin  | Create with default stages (201); first pipeline is default.|
| PATCH  | `/pipelines/:id`                | admin  | Rename or set `isDefault`.                                  |
| POST   | `/pipelines/:id/stages`         | admin  | Append a stage (201): `name`, `probability`, `kind`, `targetDays`. |
| PATCH  | `/stages/:id`                   | admin  | Update a stage.                                             |
| DELETE | `/stages/:id`                   | admin  | Delete a stage (204); rejected if it holds deals or is the pipeline's last stage. |
| POST   | `/pipelines/:id/stages/reorder` | admin  | `{ "stageIds": ["…"] }` must list every stage exactly once; returns the pipeline. |

Stage `kind` is `OPEN`, `WON`, or `LOST`. `targetDays` feeds momentum stage velocity. There is no
pipeline delete endpoint; create additional pipelines instead of deleting.

### Activities

| Method | Path              | Role   | Purpose                                                         |
| ------ | ----------------- | ------ | --------------------------------------------------------------- |
| GET    | `/activities`     | member | Paginated list. Filters: `type=NOTE\|CALL\|EMAIL\|MEETING\|TASK`, `completed=true\|false`, `due=overdue\|today\|week\|all`, `contactId`, `companyId`, `dealId`. Sort: `dueAt`, `updatedAt`, `createdAt`. |
| POST   | `/activities`     | member | Log an activity (201). Owner is the caller.                     |
| PATCH  | `/activities/:id` | member | Update; `completedAt: null` reopens a task.                     |
| DELETE | `/activities/:id` | member | Delete (204).                                                   |

`due=overdue|today|week` implies incomplete activities only.

### Insights

| Method | Path         | Role   | Purpose                                                              |
| ------ | ------------ | ------ | -------------------------------------------------------------------- |
| GET    | `/dashboard` | member | Aggregated dashboard summary. `months=3..12` controls the revenue trend window (default 6). |
| GET    | `/search`    | member | `q` (min 2 chars), returns up to 15 hits across contacts, companies, and deals with `href`s. |
| GET    | `/health`    | no     | `{ status: "ok"\|"degraded", version, uptime, database }`; 503 when the database is down. |

Dashboard payload includes `pipelineValue`, `openDealCount`, `wonValueThisMonth`, `wonCountThisMonth`,
`winRate` (0-100), `avgDealSize`, `revenueTrend`, `stageDistribution`, `activityMix`, `momentum`
counts, `recentDeals`, `tasksDue`, and the workspace `currency`.

## Tenancy and RBAC

The access token carries the workspace id. Every request re-reads the caller's membership, so role
changes and removals apply immediately. Ids from another workspace return 404, not 403. Roles:

- **MEMBER** — read everything; create/update companies, contacts, deals, activities; move stages.
- **ADMIN** — member rights plus workspace settings, invitations, member changes, audit, permanent
  deletion, pipeline/stage management.
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
