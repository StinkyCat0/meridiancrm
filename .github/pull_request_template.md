## What changed

<!-- One paragraph. Link the milestone/issue if one exists. -->

## Why

<!-- User-visible problem or engineering risk this removes. -->

## Surface

- [ ] API contract changed (`packages/contracts`)
- [ ] Database migration included
- [ ] Auth / tenancy / RBAC touched
- [ ] UI route(s) touched
- [ ] Docs updated

## Verification

<!-- Exact commands and the observable result. Do not paste screenshots of green text. -->

```bash
npm run test -w @meridian/api
npm run build
```

## Risk

<!-- Rollout, data, security, or performance risk. "None" is a valid answer. -->
