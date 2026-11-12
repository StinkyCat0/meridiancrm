import "dotenv/config";
import { randomBytes } from "node:crypto";

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isProduction = process.env.NODE_ENV === "production";

/** Never trust a client-supplied X-Forwarded-For unless an operator opts in. */
function parseTrustProxy(
  value: string | undefined,
): boolean | string | string[] {
  const raw = value?.trim();
  if (!raw || raw === "0" || raw.toLowerCase() === "false") return false;
  if (raw.toLowerCase() === "true") return true;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const WEAK_SECRET_MARKERS = [
  "change-me",
  "changeme",
  "local-development",
  "dev-secret",
  "example",
];

function resolveJwtSecret(): string {
  const candidate = (process.env.JWT_SECRET ?? "").trim();
  const weak =
    candidate.length < 32 ||
    WEAK_SECRET_MARKERS.some((marker) =>
      candidate.toLowerCase().includes(marker),
    );

  if (!weak) return candidate;

  if (isProduction) {
    throw new Error(
      "JWT_SECRET must be set to a random value of at least 32 characters (openssl rand -base64 48)",
    );
  }
  if (candidate) {
    console.warn(
      "[config] Ignoring weak JWT_SECRET; using a per-process random secret.",
    );
  }
  return randomBytes(48).toString("base64url");
}

function resolveIntakeSecret(): string {
  const candidate = (process.env.WEBSITE_INTAKE_SECRET ?? "").trim();
  const weak =
    candidate.length < 32 ||
    WEAK_SECRET_MARKERS.some((marker) =>
      candidate.toLowerCase().includes(marker),
    );

  if (!weak) return candidate;

  if (isProduction) {
    throw new Error(
      "WEBSITE_INTAKE_SECRET must be set to a random value of at least 32 characters (openssl rand -base64 48)",
    );
  }
  if (candidate) {
    console.warn(
      "[config] Ignoring weak WEBSITE_INTAKE_SECRET; website intake is disabled.",
    );
  }
  return "";
}

export const config = {
  env: process.env.NODE_ENV ?? "development",
  isProduction,
  port: int(process.env.PORT, 4000),
  host: process.env.HOST ?? "0.0.0.0",
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  jwtSecret: resolveJwtSecret(),
  /** Shared secret with the Meridian website; empty disables website SSO. */
  websiteJwtSecret: (process.env.WEBSITE_JWT_SECRET ?? "").trim(),
  jwtIssuer: "meridian-crm",
  accessTokenTtl: int(process.env.ACCESS_TOKEN_TTL, 900),
  refreshTokenTtl: int(process.env.REFRESH_TOKEN_TTL, 60 * 60 * 24 * 30),
  /** Explicit so a local HTTP deployment can keep cookies working; set 1 behind TLS. */
  cookieSecure:
    process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE === "1"
      : isProduction,
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  serveWeb: process.env.SERVE_WEB === "1",
  webDistPath: process.env.WEB_DIST_PATH ?? "../web/dist",
  refreshCookieName: "meridian_refresh",
  seedDemo: process.env.SEED_DEMO !== "0",
  webAppUrl: process.env.WEB_APP_URL ?? "http://localhost:5173",
  websiteIntakeSecret: resolveIntakeSecret(),
  websiteIntakeWorkspaceSlug:
    process.env.WEBSITE_INTAKE_WORKSPACE_SLUG ?? "meridian-studio",
} as const;
