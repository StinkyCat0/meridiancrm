# Security

## Reporting

Email security@meridianstudios.org with a description, reproduction steps, and impact. Do not open a
public issue. We aim to acknowledge within three business days and will coordinate disclosure after a
fix. This is a small studio; there is no paid bounty program.

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | Yes (current MVP)  |
| < 0.1   | No                 |

Only the latest released minor receives fixes.

## Implemented controls

- **Password hashing.** scrypt (`node:crypto`) with a random 16-byte salt, N=16384, 64-byte output,
  stored with its cost parameter and compared using `timingSafeEqual`. No native dependencies.
- **Access tokens.** HS256 JWT, 15-minute TTL, issuer and audience checked. `JWT_SECRET` must be at
  least 32 characters and must not contain placeholder markers; production refuses to boot otherwise.
- **Refresh tokens.** 384-bit random values, only SHA-256 hashes stored, rotated atomically on every
  refresh. Replaying an already-rotated token revokes the token family (reuse detection). Logout
  revokes the active token, expiry is checked, and the cookie is httpOnly, SameSite=Lax, scoped to
  `/api/v1/auth`. `COOKIE_SECURE` defaults to on in production and can be explicitly disabled only
  for local plain-HTTP deployments.
- **Tenancy.** Every top-level tenant query filters by the authenticated `workspaceId`; stages inherit
  tenancy through their pipeline. Membership is re-read per request, so role changes and removals
  take effect immediately. Cross-tenant ids return 404.
- **Role-based access.** MEMBER/ADMIN/OWNER hierarchy enforced server-side on workspace settings,
  members, invites, audit, and permanent deletion. Self-removal and last-owner removal are rejected.
- **Input validation.** Zod parsing at every route boundary; body size limited to 1 MB; SQLite LIKE
  wildcards escaped in search terms. User-supplied URLs are restricted to `http`/`https` without
  embedded credentials.
- **Trusted proxies.** `TRUST_PROXY` defaults to `false`, so client-supplied `X-Forwarded-*` headers
  are ignored. It accepts an address/CIDR only when the API sits behind a trusted reverse proxy;
  rate-limit keys then use the forwarded client address.
- **Rate limiting.** Global 600 requests/minute per client plus per-route overrides on auth
  endpoints (login is capped at 10/minute). Standard `x-ratelimit-*` headers are returned.
- **Headers and CSP.** `@fastify/helmet` sets baseline headers and a cross-origin resource policy
  suitable for the SPA. When the API serves the built SPA (`SERVE_WEB=1`), HTML responses carry a
  strict Content-Security-Policy (`default-src 'self'`, no object/frame embedding). CORS is an
  explicit origin allowlist with credentials enabled.
- **Audit trail.** Privileged and structural mutations append actor, action, entity, and metadata to
  the workspace audit log (ADMIN+ to read).
- **Invites.** Random 256-bit tokens stored hashed, 7-day expiry, single-use, revocable, and tied to
  the invited email and role.
- **Secrets and files.** Environment-only secrets; no secrets in the repository; `.env` files are
  gitignored. The container runs non-root with a restrictive umask and creates `/data` mode 700, so
  SQLite files are owner-only.

## Known limits

- No MFA, SSO/SAML, or password-reset email flow. Password changes require the current password.
- SQLite is single-writer and file-based; backups and the volume must be protected at the host level.
  There is no encryption at rest unless the volume provides it.
- Invite links are copied manually; there is no transactional email delivery, so an invite link is a
  bearer credential until it expires or is revoked.
- Access tokens cannot be revoked individually before expiry; logout and refresh-token reuse revoke
  refresh sessions. Keep the TTL short.
- Leave `TRUST_PROXY` disabled for directly exposed instances. Behind a proxy that is not configured
  as trusted, all clients share the proxy's rate-limit bucket and `X-Forwarded-Proto` is ignored.
- Rate limiting is in-process; restarting the API resets counters, and multiple instances would need
  a shared store.
- No file uploads, so no upload scanning surface exists yet.
