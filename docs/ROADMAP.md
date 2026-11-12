# Roadmap

Scope discipline: shipped means present in the release and covered by tests. Items under "Next" are
not partially built features hiding behind flags; they are deliberate gaps with a stated dependency.

## Shipped (0.2.0)

- Service-business model: typed customers, service locations with one primary per customer, and a
  price book with cost and margin inputs.
- Jobs with a single transition table, scheduling, recurrence, line items, ratings, and
  completed/canceled/no-show lifecycle events.
- Estimates with status flow, atomic conversion to jobs, and quote events.
- Invoices with a payment ledger, derived status and balance, overdue derivation, and an
  adjustment-aware `amountPaid`.
- Dispatch board, OpenStreetMap stop map, per-technician route optimization, and bulk assignment.
- Local logged inbox: calls, texts, and emails with threads, stats, unread state, and deterministic
  message drafts. No carrier or mailbox is connected.
- Customer 360 timeline merging activities, messages, jobs, quotes, invoices, and payments.
- Automations with nine triggers, optional conditions, contained actions, run history, 24-hour
  dedupe, and an admin-triggered due sweep.
- Finance: revenue, collections, refunds, outstanding, expenses, gross profit and margin, monthly
  trend, category spend, service margins, technician revenue, and top customers.
- Intelligence: deterministic recommendations, forecast, health, upsells, and an assistant brief.
  No external model is called.
- Team performance and daily workload with utilization, ratings, revenue, and margin.
- Web surfaces for dispatch, calendar, inbox, revenue, automations, intelligence, and team, plus
  pagination and freshness fixes across the existing lists.
- Review fixes #10-#17: invoice state, job status paths, overdue balance, atomic numbering and
  ordering, list pagination, query invalidation, primary-location invariant, and seed/tax polish.

See [CHANGELOG.md](../CHANGELOG.md) for the complete list.

## Shipped (0.1.0)

- Auth: register, login, refresh rotation, logout, me, profile update, password change.
- Invite-based team onboarding with roles and audit trail.
- Companies, contacts, deals, pipelines/stages, activities, stage history, momentum score.
- Dashboard analytics, global search, command palette, OpenAPI, rate limits, PWA shell, and Docker
  deployment.

## Next

Ordered by expected product leverage, not a commitment. None of these are started.

1. **Carrier and mailbox integration.** Connect an SMS/email provider or IMAP/OAuth mailbox so the
   inbox can send and receive rather than only log. Requires provider credentials, delivery
   webhooks, consent handling, and a durable worker. Until then the inbox is local bookkeeping.
2. **Scheduled automation runner.** `POST /automations/run-due` is admin-triggered today. A cron or
   queue worker would make overdue and appointment sweeps autonomous; it also needs a single-owner
   lock so multiple instances do not double-run rules.
3. **External model opt-in.** The draft and intelligence engines are local and deterministic.
   Any model integration would need an explicit workspace opt-in, redaction, provider data
   processing terms, and a fallback to the local engine.
4. **File uploads.** Expenses accept a receipt URL only. Receipt files need object storage,
   content-type validation, size limits, signed access, and retention rules.
5. **Postgres.** SQLite is single-writer and the document-number queue is in-process. Moving to
   Postgres is a Prisma provider swap plus migration rehearsal and a database sequence for document
   numbers; it unlocks multiple API instances and read replicas.
6. **Reporting exports.** CSV of filtered lists and a scheduled finance summary. No BI layer yet.
7. **Billing and plans.** Stripe subscriptions, seat counting, and entitlement checks. Needs a
   public signup decision first.
8. **SSO/SAML and MFA.** Enterprise requirement; adds identity-provider configuration and recovery
   flows.
9. **Native mobile app.** Expo client reusing contracts and api-client, including a native refresh
   token path and SecureStore. See [MOBILE.md](MOBILE.md).

## Known dependencies and limits

- **No carrier or mailbox.** Communications are local rows; "sent" means recorded, not delivered.
- **No external LLM.** Drafts and recommendations are template/rule based; they cannot generalize
  beyond the signals the engines encode.
- **No file uploads.** Only URLs are stored, and only `http`/`https` without embedded credentials.
- **SQLite single-writer.** WAL, a busy timeout, and an in-process per-workspace write queue make
  one instance reliable. Multiple instances need Postgres.
- **No native app.** The PWA is the mobile surface today.
- **OpenStreetMap tile dependency.** The dispatch map needs browser access to
  `tile.openstreetmap.org`; there is no key, no proxy, and no offline tile cache. Tiles can be
  unavailable or rate-limited, in which case stops remain usable without a basemap.
- **No payment processing.** Payments are a ledger; Meridian never moves money.

## Later / not planned

A workflow canvas UI, custom objects, a marketplace, and offline writes. These would change the data
model and are explicitly out of scope for the current product thesis.
