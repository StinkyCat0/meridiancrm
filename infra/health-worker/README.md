# Meridian health worker

A small Cloudflare Worker that probes the deployed API from outside the machine. It is **not
deployed**: `wrangler.toml` contains the placeholder `https://crm.example.com`. Nothing here runs as
part of CI.

It is useful because a Docker healthcheck only proves the container is alive on the same host. An
external edge probe catches DNS, TLS, reverse-proxy and firewall failures too.

## Endpoints

| Method | Path      | Behavior                                                                                         |
| ------ | --------- | ------------------------------------------------------------------------------------------------ |
| GET    | `/`       | Service metadata and available endpoints.                                                        |
| GET    | `/health` | Calls `${TARGET_URL}/api/v1/health` with an 8s timeout and returns a cached JSON summary.         |

`/health` responds `200` when the API returns 2xx and its database is not `down`; otherwise `503`.
The body is `{ ok, target, status, database, latencyMs, checkedAt }`. Results are cached at the edge
for 30 seconds under a canonical `/health` key; query strings are ignored so `?nonce=...` cannot
bypass the cache or trigger extra origin checks. The target is read from the `TARGET_URL` var, never
from the request, so the worker cannot be used to probe arbitrary hosts.

## Deploy

1. Install the Cloudflare CLI: `npm install -g wrangler` (or use the local dev dependency).
2. `wrangler login`
3. Set the real origin in `wrangler.toml` (`TARGET_URL = "https://crm.yourdomain.com"`).
4. From this directory: `npm install` then `npm run deploy`.
5. Verify: `curl -s https://meridian-health.<account>.workers.dev/health | jq`.

Keep `TARGET_URL` on your own zone. If the worker is public, rate limiting at Cloudflare is
recommended because each uncached request performs one outbound check.

## Using it from CI or a reverse proxy

- GitHub Actions synthetic check:
  `curl -fsS https://meridian-health.<account>.workers.dev/health`
- Caddy does not need it, but an external monitor (Better Stack, UptimeRobot) can point at the
  worker URL instead of the origin to avoid hitting the origin from several providers.
- The worker is deliberately stateless; rotating it or changing `TARGET_URL` redeploys the probe.
