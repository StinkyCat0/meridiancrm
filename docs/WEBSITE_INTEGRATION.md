# Website integration

The CRM exposes two server-to-server bridges for the marketing site
([meridian-website](https://github.com/StinkyCat0/meridian-website)): lead intake and staff SSO.
The website-side setup is documented in that repository's
[`docs/INTEGRATION.md`](https://github.com/StinkyCat0/meridian-website/blob/main/docs/INTEGRATION.md).
Live chat is owned by the website repository and is not part of this API.

Base URL: `http://localhost:4000/api/v1` in development, `https://<your-host>/api/v1` in production.
All bodies are JSON. Errors use `{ "error": { "code": "…", "message": "…" } }`.

## Contact intake

`POST /api/v1/public/intake`

Server-to-server lead capture. Requires the shared intake secret; no bearer token or cookie is used.

### Configuration

| CRM env var                     | Website env var     | Purpose                                                                         |
| ------------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| `WEBSITE_INTAKE_SECRET`         | `CRM_INTAKE_SECRET` | Shared secret, sent as `x-meridian-intake-secret`. Empty disables the endpoint. |
| `WEBSITE_INTAKE_WORKSPACE_SLUG` | —                   | Workspace that receives inquiries. Defaults to `meridian-studio`.               |

Generate the secret with `openssl rand -base64 48` and set the same value on both sides.

### Request

```http
POST /api/v1/public/intake
content-type: application/json
x-meridian-intake-secret: <shared secret>

{
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "subject": "Bathroom remodel",
  "message": "I would like a quote for a bathroom remodel.",
  "source": "website-contact"
}
```

| Field     | Rules                                                                          |
| --------- | ------------------------------------------------------------------------------ |
| `name`    | Required, trimmed, 1–100 characters.                                           |
| `email`   | Required, valid email, at most 200 characters.                                 |
| `subject` | Optional, trimmed, at most 200 characters. A blank value is treated as absent. |
| `message` | Required, trimmed, 1–5000 characters.                                          |
| `source`  | Optional, trimmed, at most 40 characters. Defaults to `website-contact`.       |

### Response

`201 Created`

```json
{ "id": "<deal id>" }
```

### Behavior

- The workspace is looked up by `WEBSITE_INTAKE_WORKSPACE_SLUG`.
- The deal is placed in the workspace's first pipeline ordered by `isDefault` descending then
  `createdAt` ascending, in that pipeline's first `OPEN` stage by stage order.
- The contact is reused when the workspace already has a contact whose email matches
  case-insensitively (earliest created wins); an archived match is unarchived. Otherwise a contact is
  created by splitting `name` into first and last name.
- The deal is titled `Website inquiry: <subject>`, or `Website inquiry` when no subject is supplied.
  It starts at value `0` in the workspace currency, carries the `website` tag, and stores the name,
  email, source, and message in its description.
- An initial stage-history row is written for the deal.
- An inbound `EMAIL` communication is recorded against the contact with status `RECEIVED`, intent
  `GENERAL`, sentiment `NEUTRAL`, provider `website`, and the submitted message as its body.
- The contact/deal/communication writes run in one transaction.
- Rate limit: 20 requests per minute per client.

### Errors

| Status | Code                  | When                                                                                                                                            |
| ------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `VALIDATION_ERROR`    | Body fails validation.                                                                                                                          |
| `401`  | `UNAUTHORIZED`        | `x-meridian-intake-secret` is missing or does not match.                                                                                        |
| `503`  | `SERVICE_UNAVAILABLE` | `WEBSITE_INTAKE_SECRET` is empty, the workspace slug does not resolve, or the workspace has no pipeline with an open stage. Nothing is written. |

## Staff SSO

`POST /api/v1/auth/website`

Exchanges an access token minted by the website for a normal CRM session. It is opt-in: with no
configured secret the endpoint always returns `503`.

### Configuration

Set `WEBSITE_JWT_SECRET` in the CRM to the same value as the website's `JWT_SECRET`. The CRM rejects
secrets shorter than 32 characters as unconfigured; leave the variable empty to disable the endpoint.

### Request

```http
POST /api/v1/auth/website
content-type: application/json

{ "token": "<website access token>" }
```

`token` must be 20–4000 characters.

### Required token claims

The token must be HS256 and carry:

- `iss`: `meridian-website`
- `aud`: `meridian-crm`
- `exp`: expiration time (required; a correctly signed token without `exp` is rejected)
- `user.email`: the account's email address (string)
- `user.isVerified`: `true`
- `user.crmAccess`: `true`
- an identity in `sub` or, if `sub` is absent, `user.id` (string)

`user.role` and any tenant/workspace claim are ignored. The website token never selects a CRM
tenant or role.

### Response

`200 OK` with the same session shape as `POST /api/v1/auth/login`:

```json
{
  "accessToken": "<crm jwt>",
  "expiresIn": 900,
  "user": {
    "id": "…",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "avatarUrl": null
  },
  "workspace": {
    "id": "…",
    "name": "…",
    "slug": "…",
    "currency": "USD",
    "businessType": "GENERAL",
    "timezone": "America/Chicago",
    "serviceArea": null,
    "depotLatitude": null,
    "depotLongitude": null,
    "createdAt": "…"
  },
  "role": "OWNER"
}
```

The refresh cookie (`meridian_refresh`, httpOnly, path `/api/v1/auth`) is set, so the browser client
must send the request with credentials included and then use the access token like any other CRM
session. A successful exchange is audited as `auth.website_sso` with the website user id only.

### Behavior and errors

- The CRM user is found by lowercased `user.email`. The role and workspace come from that user's
  earliest `Membership` (`createdAt` ascending), never from the token.
- If the user or membership does not exist, both cases return the same error, so account linkage is
  not disclosed.

| Status | Code                  | When                                                                                                                    |
| ------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `400`  | `VALIDATION_ERROR`    | `token` is missing, too short, or too long.                                                                             |
| `401`  | `UNAUTHORIZED`        | Bad signature, wrong issuer/audience, missing/expired `exp`, malformed claims, or no CRM user/membership for the email. |
| `403`  | `FORBIDDEN`           | `user.isVerified` is not `true` or `user.crmAccess` is not `true`.                                                      |
| `503`  | `SERVICE_UNAVAILABLE` | `WEBSITE_JWT_SECRET` is empty or shorter than 32 characters.                                                            |

Rate limit: 10 requests per minute per client.

## Operational notes

- Rotate shared secrets as pairs and deploy both sides together: `WEBSITE_JWT_SECRET` (CRM) with the
  website's `JWT_SECRET`, and `WEBSITE_INTAKE_SECRET` (CRM) with the website's `CRM_INTAKE_SECRET`.
  Rotating the JWT secret invalidates outstanding website SSO tokens (but not existing CRM sessions);
  rotating the intake secret makes in-flight submissions with the old header fail with `401`.
- The website token is an identity assertion only. Tenant and role are always resolved from the CRM
  `Membership` table, and the website's `role` claim is deliberately not trusted.
- Website chat remains in the website repository; only intake and SSO cross the boundary.

### Session revocation

`user.crmAccess` is checked only when a website token is exchanged. Revoking `access.canAccessCrm` in
the website's Mongo database therefore does **not** revoke a CRM session that has already been issued.
That session, and its CRM refresh token, remains valid until the user's `Membership` is removed, the
refresh token is revoked, or the token expires. Rotating `WEBSITE_JWT_SECRET` blocks future exchanges
and invalidates outstanding website tokens, but it does not revoke existing CRM refresh tokens.

To revoke a staff member's CRM access immediately:

1. Remove the user's `Membership` from the workspace. Protected requests check the membership on every
   call, and `/auth/refresh` fails once it is gone.
2. Revoke the user's outstanding `RefreshToken` rows (or delete them) so refresh cannot succeed, then
   clear the `meridian_refresh` cookie in the client. Access tokens already issued remain valid until
   their normal 15-minute TTL.
3. If no further exchanges should be accepted, rotate `WEBSITE_JWT_SECRET` on the CRM and the website's
   `JWT_SECRET` together and deploy both sides.

Revoking only `access.canAccessCrm` stops new exchanges; it leaves existing sessions untouched.

### Refresh cookie scope

The exchange sets the standard CRM refresh cookie: `meridian_refresh`, `HttpOnly`, `SameSite=Lax`,
scoped to `/api/v1/auth` (and `Secure` when configured). A cross-site browser XHR from the website SPA
can read `accessToken` from the response body, but browsers will not persist or send that `Lax` cookie
for the cross-site request, so refresh will not be available on the next page load. The exchange is
intended for a same-site CRM client or a redirect onto the CRM origin, not an arbitrary cross-site
fetch from the website origin.
