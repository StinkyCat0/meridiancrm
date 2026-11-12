# Security

## Reporting

Email security@meridianstudios.org with a description, reproduction steps, and impact. Do not open a
public issue; the repository is public, so a report must not include live credentials or customer
data. We aim to acknowledge within three business days and will coordinate disclosure after a fix.
This is a small studio; there is no paid bounty program.

## Supported versions

| Version | Supported     |
| ------- | ------------- |
| 0.2.x   | Yes (current) |
| 0.1.x   | No            |
| < 0.1   | No            |

Only the latest released minor receives fixes.

## Trust boundaries

- **Communications are local records.** There is no SMS carrier, mailbox, or email provider
  connected. Logging a message writes a `Communication` row with `provider: "log"`; automation
  messages use `provider: "automation"`. Both keep `externalId: null`. A status of `SENT` means
  recorded in the workspace, not delivered. No outbound network call is made for a message.
- **Carrier/mailbox adapter (not implemented).** No provider credential, outbound send path, or
  webhook route exists. ADR-014 fixes the boundary before one ships: verify the provider HMAC over
  the raw body with a constant-time compare and a five-minute timestamp window, deduplicate on
  provider event/message ids before writing, persist an outbox row with an idempotency key before
  sending, map delivery states without regressions, bind inbound tenancy to endpoint configuration
  and the verified secret rather than the payload, and keep per-provider secrets outside the
  database, client, and logs. Enabling a provider also requires consent/opt-out handling and a
  retention review.
- **Assistant and intelligence are local engines.** Message drafts and recommendations come from
  deterministic templates and rules in the repository. No customer data is sent to a model provider,
  and no model API key exists in the deployment.
- **Payments are a ledger.** Meridian records `Payment` rows and maintains `Invoice.amountPaid` in
  the same transaction. It does not process cards, store card data, or move money.
- **Maps disclose request metadata to OpenStreetMap.** The dispatch map loads raster tiles directly
  from `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` in the browser. No API key is used, but
  each tile request discloses the browser's IP address and the approximate viewed area to
  OpenStreetMap. Attribution is rendered, and stops remain usable if tiles fail. A privacy notice
  must mention this dependency; self-hosting tiles or choosing another provider is a deployment
  decision, not a code toggle.

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
- **Tenancy.** Every top-level tenant query filters by the authenticated `workspaceId`; stages
  inherit tenancy through their pipeline, payments and communications through their invoice or
  customer, and automation runs through their rule. Membership is re-read per request, so role
  changes and removals take effect immediately. Cross-tenant ids return 404.
- **Tenant checks in the service suite.** Dispatch assignment verifies that the assignee is a member
  of the caller's workspace. Location, service, job, estimate, invoice, expense, payment, timeline,
  finance, intelligence, and team queries are workspace-scoped, including joins through invoices and
  jobs. Document counters are keyed by workspace.
- **Role-based access.** MEMBER/ADMIN/OWNER hierarchy enforced server-side on workspace settings,
  members, invites, audit, permanent deletion, pipeline/stage management, automation rule changes
  and the due sweep, expense mutations, and communication deletion. Finance reads, payment
  recording, dispatch assignment, drafts, and intelligence remain member-level. Self-removal and
  last-owner removal are rejected.
- **Automation containment.** Rules can only create a workspace-scoped task, log a communication
  (optionally from the local draft engine), add a customer tag, or request a review. There is no
  arbitrary HTTP action, shell action, or code execution. Rules and runs are workspace-scoped; the
  due sweep requires ADMIN; the same rule cannot run twice for the same trigger and entity within
  24 hours. Each rule runs in its own transaction, failures are recorded as `FAILED`, and an
  automation failure never fails the write that emitted the event or blocks sibling rules.
- **Payment integrity.** Payments above the invoice amount are rejected, paid invoices cannot be
  reopened, void invoices cannot be edited, and negative corrections are written as `ADJUSTMENT`
  ledger rows. Status and overdue are derived, not trusted from the client.
- **Input validation.** Zod parsing at every route boundary; body size limited to 1 MB; SQLite LIKE
  wildcards escaped in search terms. User-supplied URLs (including expense `receiptUrl`) are
  restricted to `http`/`https` without embedded credentials.
- **Trusted proxies.** `TRUST_PROXY` defaults to `false`, so client-supplied `X-Forwarded-*` headers
  are ignored. It accepts an address/CIDR only when the API sits behind a trusted reverse proxy;
  rate-limit keys then use the forwarded client address.
- **Rate limiting.** Global 600 requests/minute per client plus per-route overrides on auth
  endpoints (login is capped at 10/minute). Standard `x-ratelimit-*` headers are returned.
- **Headers and CSP.** `@fastify/helmet` sets baseline headers and a cross-origin resource policy
  suitable for the SPA. When the API serves the built SPA (`SERVE_WEB=1`), HTML responses carry a
  strict Content-Security-Policy (`default-src 'self'`, no object/frame embedding, images allowed
  over https for map tiles). CORS is an explicit origin allowlist with credentials enabled.
- **Audit trail.** Privileged and structural mutations append actor, action, entity, and metadata to
  the workspace audit log (ADMIN+ to read), including job status changes, invoice payments, expenses,
  and automation changes.
- **Invites.** Random 256-bit tokens stored hashed, 7-day expiry, single-use, revocable, and tied to
  the invited email and role.
- **CI security gates.** CodeQL `security-extended` runs on pull requests, pushes to `main`, and a
  weekly schedule. The Verify job runs `npm audit --omit=dev --audit-level=critical`, a Prettier check, contracts tests, API tests with a coverage floor,
  sequential typechecks, and both builds.
- **Secrets and files.** Environment-only secrets; no secrets in the repository; `.env` files are
  gitignored. The container runs non-root with a restrictive umask and creates `/data` mode 700, so
  SQLite files are owner-only.
- **Backup and restore safety.** `scripts/backup-sqlite.sh` takes a WAL-safe snapshot
  (`sqlite3 ".backup"` or `VACUUM INTO`), verifies `PRAGMA integrity_check`, writes mode 600, and
  renames atomically. `scripts/restore-sqlite.sh` verifies the snapshot, requires `--force`, refuses
  to run while `lsof` reports an open database or journal files remain, keeps the previous database
  as a mode-600 `.pre-restore.<timestamp>` copy, and installs the verified file atomically. Neither
  script prints `DATABASE_URL` or credentials. Snapshots are unencrypted; protect them at rest.
- **Scheduled sweep workflow.** `.github/workflows/automations.yml` calls the ADMIN-only due sweep
  with a token held in an Actions secret, passed through the environment (never interpolated into a
  logged command), with bash tracing disabled. The job has no repository permissions, checks out no
  code, serializes concurrent runs, has a five-minute timeout, and logs a notice instead of calling
  the API when the URL or secret is unset.

## Known limits

- No carrier or mailbox: the inbox cannot deliver, receive, or verify email/SMS, and there are no
  provider webhooks or consent workflows to secure yet. Any future integration must implement the
  ADR-014 boundary (verified webhooks, replay window, idempotent outbox, delivery-state mapping,
  consent, and secret storage) before it is enabled; the current deployment calls no provider.
- No external model: draft and recommendation quality is bounded by local rules, but there is also
  no provider data-processing surface.
- No MFA, SSO/SAML, or password-reset email flow. Password changes require the current password.
- SQLite is single-writer and file-based; backups and the volume must be protected at the host level.
  There is no encryption at rest unless the volume provides it, and `scripts/backup-sqlite.sh`
  produces unencrypted snapshots of every workspace record: restrict directory permissions, encrypt
  or store them on an encrypted volume, and keep copies off the host. The document-number queue is
  in-process, so multiple API instances are unsupported.
- No file uploads; only receipt URLs are stored, with no scanning surface.
- The dispatch map depends on public OpenStreetMap tiles. Tile requests disclose IP and approximate
  viewed area to OSM, and availability/rate limits are outside our control.
- Invite links are copied manually; there is no transactional email delivery, so an invite link is a
  bearer credential until it expires or is revoked.
- Access tokens cannot be revoked individually before expiry; logout and refresh-token reuse revoke
  refresh sessions. Keep the TTL short.
- Leave `TRUST_PROXY` disabled for directly exposed instances. Behind a proxy that is not configured
  as trusted, all clients share the proxy's rate-limit bucket and `X-Forwarded-Proto` is ignored.
- Rate limiting is in-process; restarting the API resets counters, and multiple instances would need
  a shared store.
