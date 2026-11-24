# Studio integration contract

Status: implementation contract for the website ↔ CRM Studio admin surfaces.

The Meridian website remains the system of record for public/customer identity, contact inquiries,
live chat, subscriptions, and demo traffic. MongoDB stays behind the website API. The CRM never opens
the website database and never receives password hashes. The CRM adds a **Studio** section whose
server-side BFF calls the website's service-token API.

## Why this shape

- Two repositories stay independently deployable and reviewable.
- The website can rotate its Mongo schema without changing CRM tables.
- The CRM can enforce staff roles and audit every admin write.
- Shared secrets live only in server environments, never in browser bundles.

## Environment

Website `apps/api/.env`:

```dotenv
# Public CRM origin, used for the one-time login handoff redirect.
CRM_URL=https://crm.example.com
# Service-to-service credential for /api/studio/*. Generate once:
#   openssl rand -base64 48
STUDIO_API_TOKEN=
```

CRM `apps/api/.env`:

```dotenv
# Website origin, no trailing slash, e.g. https://meridianstudios.org
WEBSITE_STUDIO_URL=
# Same value as the website STUDIO_API_TOKEN.
WEBSITE_STUDIO_TOKEN=
# Public website origin used for "open website" links.
WEBSITE_PUBLIC_URL=https://meridianstudios.org
```

Both Studio surfaces are disabled (503) when their credentials are absent or shorter than 32
characters. Secrets are never committed, logged, or returned in responses.

## Website service API (`/api/studio`)

All routes require:

```http
x-meridian-studio-token: <STUDIO_API_TOKEN>
```

and are server-to-server only. The token comparison is constant-time. The API returns 503 when
`STUDIO_API_TOKEN` is unconfigured, 401 on a wrong/missing token. Rate limit: 120 requests/minute.

### Shapes

```ts
type StudioAccount = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  isVerified: boolean;
  isActive: boolean;
  access: {
    canLogin: boolean;
    canAccessChat: boolean;
    canAccessPremiumFeatures: boolean;
    canAccessCrm: boolean;
  };
  subscription: {
    plan: "free" | "basic" | "pro" | "enterprise";
    status: "active" | "canceled" | "past_due" | "trialing";
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
  avatar: string | null;
  createdAt: string;
  lastLogin: string | null;
};

type StudioInquiry = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: "new" | "read" | "archived";
  crmDealId: string | null;
  createdAt: string;
  readAt: string | null;
  archivedAt: string | null;
};

type StudioRoom = {
  id: string;
  name: string;
  description: string;
  isReadOnly: boolean;
  archived: boolean;
  createdAt: string;
  messageCount?: number;
  lastMessageAt?: string | null;
};

type StudioMessage = {
  id: string;
  roomId: string;
  content: string;
  author: {
    id: string;
    name: string;
    avatar: string | null;
    role: string;
  } | null;
  parentId: string | null;
  attachments: { url: string; filename: string; type: string; size: number }[];
  reactions: { emoji: string; userIds: string[] }[];
  edited: boolean;
  createdAt: string;
  replies: StudioMessage[];
  replyCount: number;
};

type StudioDemo = {
  key: "dental" | "luxesm" | "bakery" | "corrowear";
  name: string;
  path: string;
  description: string;
  visits: number;
  lastVisitedAt: string | null;
};

type StudioBillingPage = {
  summary: {
    total: number;
    active: number;
    pastDue: number;
    canceling: number;
    plans: { free: number; basic: number; pro: number; enterprise: number };
  };
  items: {
    id: string;
    name: string;
    email: string;
    plan: "free" | "basic" | "pro" | "enterprise";
    status: "active" | "canceled" | "past_due" | "trialing";
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    createdAt: string;
  }[];
  page: number;
  pageSize: number;
  total: number;
};

type StudioSettings = {
  integrations: {
    key: string;
    label: string;
    status: "up" | "down" | "enabled" | "disabled" | "configured" | "missing";
    detail?: string | null;
  }[];
  links: { label: string; url: string }[];
};
```

Never return `password`, verification/reset tokens, lockout fields, or `stripeCustomerId`.

### Endpoints

| Method | Path                       | Body / query                                          | Response                                                                         |
| ------ | -------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/overview`                | —                                                     | `{ generatedAt, accounts, subscriptions, inquiries, chat, demos, integrations }` |
| GET    | `/accounts`                | `search`, `page`, `pageSize`                          | `{ items: StudioAccount[], page, pageSize, total }`                              |
| PATCH  | `/accounts/:id`            | `{ canAccessCrm?, canAccessChat?, isActive? }`        | `{ account: StudioAccount }`                                                     |
| GET    | `/inquiries`               | `status=all\|new\|read\|archived`, `page`, `pageSize` | `{ items: StudioInquiry[], page, pageSize, total }`                              |
| PATCH  | `/inquiries/:id`           | `{ status }`                                          | `{ inquiry: StudioInquiry }`                                                     |
| GET    | `/chat/rooms`              | `includeArchived=true`                                | `{ items: StudioRoom[] }`                                                        |
| POST   | `/chat/rooms`              | `{ name, description?, isReadOnly? }`                 | `{ room: StudioRoom }`                                                           |
| PATCH  | `/chat/rooms/:id`          | `{ name?, description?, isReadOnly? }`                | `{ room: StudioRoom }`                                                           |
| DELETE | `/chat/rooms/:id`          | —                                                     | `{ room: StudioRoom }` (archive)                                                 |
| GET    | `/chat/rooms/:id/messages` | `limit`, `before`                                     | `{ items: StudioMessage[] }`                                                     |
| POST   | `/chat/rooms/:id/messages` | `{ content, authorEmail, parentId? }`                 | `{ message: StudioMessage }`                                                     |
| GET    | `/billing`                 | `page`, `pageSize`                                    | `{ summary, items, page, pageSize, total }`                                      |
| GET    | `/demos`                   | —                                                     | `{ items: StudioDemo[] }`                                                        |
| GET    | `/settings`                | —                                                     | `{ integrations, links }`                                                        |
| POST   | `/sso/inspect`             | `{ code }`                                            | `{ websiteUserId, email, name, isVerified, crmAccess, expiresAt }`               |
| POST   | `/sso/consume`             | `{ code }`                                            | same as inspect                                                                  |

`overview` shape:

```json
{
  "generatedAt": "2026-11-23T00:00:00.000Z",
  "accounts": {
    "total": 0,
    "verified": 0,
    "crmAccess": 0,
    "active": 0,
    "admins": 0
  },
  "subscriptions": {
    "free": 0,
    "basic": 0,
    "pro": 0,
    "enterprise": 0,
    "pastDue": 0
  },
  "inquiries": {
    "total": 0,
    "new": 0,
    "read": 0,
    "archived": 0,
    "last7Days": 0
  },
  "chat": { "rooms": 0, "messages": 0, "messages7Days": 0 },
  "demos": [
    {
      "key": "bakery",
      "name": "The Daily Knead",
      "path": "/bakery",
      "visits": 0
    }
  ],
  "integrations": {
    "mongo": "up",
    "email": "enabled",
    "crmIntake": "configured",
    "crmHandoff": "configured"
  }
}
```

### Account update safety

- At least one field is required.
- `canAccessCrm` and `canAccessChat` are booleans.
- Deactivating the last active website admin is rejected with `409`.
- The response never includes a password or token.

### Demos

Public, unauthenticated:

- `GET /api/demos` → `{ items: StudioDemo[] }`
- `POST /api/demos/:key/visit` → `{ key, visits }`, rate limited 60/min per IP.

The website home uses these to replace the per-browser `localStorage` counters. The CRM Studio
demos tab reads the same counts through `/api/studio/demos`.

## One-time login handoff

The website already has a signed JWT exchange (`POST /api/v1/auth/website`). That remains supported.
The Studio handoff is the preferred browser flow because it avoids cross-site refresh-cookie limits.

1. A verified website user with `access.canAccessCrm` calls `POST /api/auth/crm-handoff` with their
   website bearer token.
2. The website creates a random 32-byte code, stores only its SHA-256 hash with a 60-second expiry,
   and returns `{ "url": "<CRM_URL>/login/website?code=<code>" }`.
3. The CRM login page calls `POST /api/v1/auth/website/handoff/preview` with the code. The CRM server
   calls the website `/api/studio/sso/inspect` with the service token and shows the account email.
4. On explicit confirmation, the browser calls `POST /api/v1/auth/website/handoff`. The CRM server
   calls `/api/studio/sso/consume`; the website atomically marks the code used. The CRM then resolves
   the email to an existing CRM `User` + earliest `Membership` and issues a normal CRM session.
5. The website code is single-use, expires in 60 seconds, is bound to the website user, and is
   rejected once the account loses `isVerified` or `canAccessCrm`.

The handoff never trusts website role/workspace claims. CRM role and workspace come only from the CRM
membership. Unknown emails and users without a membership return the same 401. The CRM audits a
successful exchange as `auth.website_handoff` with the website user id only.

If `WEBSITE_STUDIO_URL`/`WEBSITE_STUDIO_TOKEN` or `CRM_URL`/`STUDIO_API_TOKEN` are missing, the
handoff returns 503 and the website shows the normal CRM link instead.

## CRM BFF (`/api/v1/studio`)

All routes require a CRM bearer token and the `ADMIN` role (OWNER or ADMIN). They proxy the website
API, map timeouts/5xx to `502 BAD_GATEWAY` and an unconfigured bridge to `503 SERVICE_UNAVAILABLE`.
Actionable website responses are preserved: `400`, `403`, `404`, and `409` reach the CRM client;
a website `401` means the CRM service token is wrong and is reported as `502` so it is not confused
with the CRM user's session. Admin writes are audited:

| Action                             | Audit action                                          |
| ---------------------------------- | ----------------------------------------------------- |
| Account flags changed              | `studio.account_updated`                              |
| Inquiry status changed             | `studio.inquiry_updated`                              |
| Chat room created/updated/archived | `studio.chat_room_created` / `_updated` / `_archived` |
| Chat message posted                | `studio.chat_message_posted`                          |

The CRM BFF passes the signed-in CRM user's email as `authorEmail` for chat messages; it never
accepts an arbitrary author from the browser.

## Non-goals

- No shared database.
- No website password copied into CRM.
- No production seed. The demo seed refuses `NODE_ENV=production` and non-local Mongo URLs unless
  explicitly overridden by the operator.
- No Stripe checkout in CRM; billing is a read-only view of the existing subscription fields.
