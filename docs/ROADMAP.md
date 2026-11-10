# Roadmap

Scope discipline: the MVP is the contract below. Items under "Next" are deliberately excluded from
0.1.0; nothing here is a partially built MVP feature.

## Shipped (0.1.0)

- Auth: register, login, refresh rotation, logout, me, profile update, password change.
- Invite-based team onboarding with roles and audit trail.
- Companies, contacts, deals, pipelines/stages, activities, stage history.
- Momentum score and signal UI, dashboard analytics, global search / command palette.
- OpenAPI docs, consistent errors, rate limits, PWA shell, Docker and Compose deployment.

See [CHANGELOG.md](../CHANGELOG.md) for the complete list.

## Next

Ordered by expected product leverage, not a commitment.

1. **Email integration.** OAuth/IMAP sync of threads onto contacts and deals, with activity
   auto-logging. Requires a worker and provider credentials; the current API is single-process.
2. **Automations.** Trigger/action rules (stage change -> task, inactivity -> alert) with a durable
   scheduler. Push notifications depend on this.
3. **Reporting exports.** CSV of filtered lists and a scheduled pipeline summary. No BI layer yet.
4. **Billing and plans.** Stripe subscriptions, seat counting, and entitlement checks. Needs a public
   signup decision first.
5. **SSO/SAML and MFA.** Enterprise requirement; adds identity-provider configuration and recovery
   flows.
6. **Native mobile app.** Expo client reusing contracts and api-client, including a native refresh
   token path and SecureStore. See [MOBILE.md](MOBILE.md).
7. **Database scaling.** Evaluate Postgres for concurrent writers and read replicas; MongoDB is not
   a candidate because the model is explicitly relational (memberships, stage history, reports).
   Any change starts as a Prisma provider swap plus migration rehearsal.

## Later / not planned

File uploads, a workflow canvas UI, custom objects, and a marketplace. These would change the data
model and are explicitly out of scope for the current product thesis.
