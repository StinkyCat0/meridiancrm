# Mobile

The native app is **not built yet**. This document records what exists today and the port plan that
keeps the API, contracts, and client reusable.

## Today: installable PWA

The web app ships as a Progressive Web App (manifest plus a service worker via `vite-plugin-pwa`).
On a phone:

1. Open the deployed URL in Safari (iOS) or Chrome (Android).
2. iOS: Share -> Add to Home Screen. Android: menu -> Install app / Add to Home screen.
3. The app opens standalone with the dark shell cached; data always comes from the API, so a network
   connection is required for mutations and for uncached reads.

The PWA is the mobile experience in this release. It uses responsive layouts and the same REST API;
there is no separate mobile backend.

## Port strategy

Reuse `@meridian/contracts` (types, enums, Zod schemas, momentum scoring) and `@meridian/api-client`
(typed calls). Do not duplicate business rules in React Native components.

```text
Expo app
  app/                    Expo Router routes
  src/lib/api.ts          configured @meridian/api-client instance
  src/lib/session.ts      SecureStore token handling
  src/components/         presentational primitives only
  src/hooks/              TanStack Query hooks over the api-client
```

### Screen map

| Web area              | Expo Router route                          | Notes                                                   |
| --------------------- | ------------------------------------------ | ------------------------------------------------------- |
| Login / register      | `app/(auth)/login.tsx`, `register.tsx`     | Same auth endpoints; native secure token storage.       |
| Invite acceptance     | `app/(auth)/invite/[token].tsx`            | Uses `GET /auth/invite/:token` then accept.             |
| Dashboard / overview  | `app/(tabs)/index.tsx`                     | `GET /dashboard`; pull-to-refresh.                      |
| Contacts              | `app/(tabs)/contacts/index.tsx`            | List + `[id].tsx` detail; search via `q`.               |
| Companies             | `app/(tabs)/companies/index.tsx`           | Linked from contacts and deals.                         |
| Deals                 | `app/(tabs)/deals/index.tsx`               | Stage columns or grouped list; `[id].tsx` detail.       |
| Activities            | `app/(tabs)/activities/index.tsx`          | Segmented by type; due tasks first.                     |
| Settings / team       | `app/(tabs)/settings/index.tsx`            | Profile, password, members, invites, audit (ADMIN+).    |
| Command palette       | `app/search.tsx` (modal)                   | `GET /search?q=`; debounced.                            |

Tabs: overview, contacts, deals, activities, settings. Companies live inside contacts navigation to
avoid a sixth tab.

## Token storage and the refresh caveat

Native clients do not share the browser cookie jar. The current refresh token is delivered only as
an httpOnly cookie, which a native client cannot use. Two options, in order of preference:

1. **Planned: native refresh endpoint.** Add a request flag (for example
   `X-Client: native`) or a dedicated `POST /auth/refresh` body variant that returns the refresh
   token in the response so it can be stored in SecureStore and sent back explicitly. Keep the cookie
   path for browsers.
2. Interim: store only the short-lived access token and require re-login when it expires. This is
   acceptable for a prototype but not for release.

Access and refresh tokens must go in `expo-secure-store` (Keychain / Keystore), never
`AsyncStorage`. Do not log them. Clear them on 401 after one refresh attempt.

## Shared primitives

| Web primitive         | React Native equivalent                          |
| --------------------- | ------------------------------------------------ |
| Tailwind classes      | `StyleSheet` + shared token module (colors, spacing). |
| React Router          | Expo Router (file-based).                         |
| TanStack Query        | Same package; `focusManager` from AppState.       |
| `fetch` api-client    | Same; inject base URL and auth header provider.   |
| dnd-kit board         | `react-native-gesture-handler` / Reanimated, or stage picker sheet. |
| Recharts              | `victory-native` or compact native sparklines.    |
| Sonner toasts         | Native toast/snackbar component.                  |
| Lucide icons          | `lucide-react-native`.                            |
| CSS focus rings       | Native accessibility focus (no hover state).      |

Keep components dumb: formatting helpers from `@meridian/contracts` (`formatMoney`, `initials`,
`computeMomentum`) are portable TypeScript; do not reimplement them.

## Offline behavior

- Read cache: TanStack Query persisted with AsyncStorage/SQLite, keyed by workspace. Render stale
  data with an offline banner; never queue mutations silently.
- Writes: disabled with an explicit "You are offline" state. A mutation queue is out of scope until
  conflict semantics exist.
- Auth refresh while offline fails fast; keep the user on the cached screen with a reconnect prompt.

## Push notifications (later)

Not implemented. Plan: register an Expo push token after login, store it against the membership, and
send task reminders server-side. This requires a scheduling worker outside the current single-process
API, so it belongs with automations in the roadmap.

## Non-goals for the first native release

Offline writes, background sync, tablet-specific layouts, biometric unlock, and shared deep links
beyond invite URLs. Add them only when the PWA proves the demand.
