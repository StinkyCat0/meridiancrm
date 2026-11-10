export interface Env {
  TARGET_URL: string;
}

interface HealthPayload {
  ok: boolean;
  target: string;
  status: number | null;
  database: "up" | "down" | null;
  latencyMs: number;
  checkedAt: string;
}

const TIMEOUT_MS = 8_000;
const CACHE_SECONDS = 30;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
      ...headers,
    },
  });

async function check(target: string): Promise<HealthPayload> {
  const started = Date.now();
  const base: HealthPayload = {
    ok: false,
    target,
    status: null,
    database: null,
    latencyMs: 0,
    checkedAt: new Date().toISOString(),
  };

  try {
    const response = await fetch(`${target.replace(/\/+$/, "")}/api/v1/health`, {
      headers: { accept: "application/json", "user-agent": "meridian-health-worker" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Never follow a redirect to a different host.
      redirect: "manual",
    });

    let database: "up" | "down" | null = null;
    try {
      const body = (await response.json()) as { database?: string };
      if (body.database === "up" || body.database === "down") database = body.database;
    } catch {
      // Non-JSON response: report status only.
    }

    return {
      ...base,
      ok: response.ok && database !== "down",
      status: response.status,
      database,
      latencyMs: Date.now() - started,
    };
  } catch {
    return { ...base, latencyMs: Date.now() - started };
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET." } }, 405, {
        allow: "GET, HEAD",
      });
    }

    if (url.pathname === "/") {
      return json({
        service: "meridian-health",
        description: "Uptime probe for Meridian CRM. GET /health for a cached check.",
        endpoints: { health: "/health" },
      });
    }

    if (url.pathname === "/health") {
      // 30s edge cache keyed only by origin + path: query strings are ignored so
      // `?nonce=...` cannot force an origin check or bypass the cache.
      const cache = caches.default;
      const cacheKey = new Request(new URL("/health", url.origin).toString(), { method: "GET" });
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      // TARGET_URL is operator-controlled (wrangler var), never taken from the request:
      // no user-controlled URLs, so the worker cannot be used as an SSRF proxy.
      const payload = await check(env.TARGET_URL);
      const response = json(payload, payload.ok ? 200 : 503, { "x-checked-at": payload.checkedAt });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    return json({ error: { code: "NOT_FOUND", message: "Only / and /health exist." } }, 404);
  },
};
