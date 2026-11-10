# Review Standard

Every PR is reviewed against this list. Findings are filed as GitHub issues with a severity label;
blocking findings are fixed before merge. Reviews are evidence-based: file and line, observed
behavior, and a concrete failure scenario.

## Blocking

- **Tenancy**: any query/update keyed only by an entity id without `workspaceId`; cross-workspace
  reads or writes; membership role read from the JWT instead of the database.
- **Auth**: refresh-token reuse accepted; token returned in JSON; password or token logged; cookies
  without `httpOnly`; missing rate limit on login.
- **Validation**: request body used without a Zod parse; mass assignment of role/owner/workspace.
- **Data**: destructive delete without role check; stage move outside a transaction; cents stored as
  floats; dates serialized without ISO.
- **Secrets**: `.env` committed; real keys in fixtures, docs, or CI.
- **Broken behavior**: an endpoint that returns a shape different from `packages/contracts`.

## Should fix

- N+1 queries on list/dashboard paths; missing indexes for list filters.
- Missing empty/loading/error UI states; inaccessible dialog or form.
- Mutable global state in the web app; duplicated design tokens or fetch calls outside the client.
- Tests that assert implementation text instead of behavior.
- Dead code, unused exports, TODOs, commented-out blocks.

## Out of scope for MVP (do not file as bugs)

Email sync, billing, SSO/MFA, native mobile builds, offline writes, multi-workspace switching.
