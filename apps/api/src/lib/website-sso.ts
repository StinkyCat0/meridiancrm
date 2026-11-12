import { jwtVerify, type JWTPayload } from "jose";

const WEBSITE_ISSUER = "meridian-website";
const WEBSITE_AUDIENCE = "meridian-crm";
/** HS256 secrets shorter than this are treated as unconfigured, not merely weak. */
const MIN_SECRET_LENGTH = 32;

const encoder = new TextEncoder();

export type WebsiteSsoFailureReason = "unconfigured" | "invalid" | "forbidden";

export class WebsiteSsoError extends Error {
  readonly reason: WebsiteSsoFailureReason;

  constructor(reason: WebsiteSsoFailureReason) {
    super(
      reason === "unconfigured"
        ? "Website SSO is not configured"
        : reason === "forbidden"
          ? "This website account is not allowed to use the CRM"
          : "This website session is invalid or expired",
    );
    this.name = "WebsiteSsoError";
    this.reason = reason;
  }
}

export interface WebsiteTokenClaims {
  email: string;
  verified: boolean;
  crmAccess: boolean;
  websiteUserId: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function websiteUserIdOf(
  payload: JWTPayload,
  user: Record<string, unknown>,
): string | null {
  if (typeof payload.sub === "string" && payload.sub.length > 0) {
    return payload.sub;
  }
  if (typeof user.id === "string" && user.id.length > 0) return user.id;
  return null;
}

/**
 * Verifies a Meridian website access token. The website's role claim is
 * deliberately ignored: CRM roles come only from the local membership.
 */
export async function verifyWebsiteToken(
  token: string,
  secret: string,
): Promise<WebsiteTokenClaims> {
  const signingSecret = secret.trim();
  if (signingSecret.length < MIN_SECRET_LENGTH) {
    throw new WebsiteSsoError("unconfigured");
  }

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(token, encoder.encode(signingSecret), {
      algorithms: ["HS256"],
      issuer: WEBSITE_ISSUER,
      audience: WEBSITE_AUDIENCE,
      requiredClaims: ["exp"],
    });
    payload = verified.payload;
  } catch {
    throw new WebsiteSsoError("invalid");
  }

  const user = asRecord(payload.user);
  if (!user) throw new WebsiteSsoError("invalid");

  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (!email) throw new WebsiteSsoError("invalid");

  const websiteUserId = websiteUserIdOf(payload, user);
  if (!websiteUserId) throw new WebsiteSsoError("invalid");

  if (user.isVerified !== true || user.crmAccess !== true) {
    throw new WebsiteSsoError("forbidden");
  }

  return {
    email,
    verified: true,
    crmAccess: true,
    websiteUserId,
  };
}
