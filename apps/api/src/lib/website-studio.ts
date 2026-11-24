import { config } from "../config.js";

/** Website Studio calls must fail fast; the BFF maps this budget to 502. */
const STUDIO_TIMEOUT_MS = 5_000;

export type WebsiteStudioFailureReason =
  "unconfigured" | "unavailable" | "upstream";

const MESSAGES: Record<WebsiteStudioFailureReason, string> = {
  unconfigured: "Website Studio is not configured",
  unavailable: "The website Studio API is unavailable",
  upstream: "The website Studio API returned an error",
};

export class WebsiteStudioError extends Error {
  readonly reason: WebsiteStudioFailureReason;
  /** Upstream HTTP status when the website answered; null on timeout/network. */
  readonly status: number | null;

  constructor(
    reason: WebsiteStudioFailureReason,
    status: number | null = null,
  ) {
    super(MESSAGES[reason]);
    this.name = "WebsiteStudioError";
    this.reason = reason;
    this.status = status;
  }
}

/** Both settings are required; the token is never echoed or logged. */
export function studioConfigured(): boolean {
  return config.websiteStudioUrl !== "" && config.websiteStudioToken !== "";
}

export interface WebsiteStudioRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

/**
 * Calls the website service API with the shared service token. Never pass the
 * token to a response, error message, or log line.
 */
export async function websiteStudioRequest<T>(
  path: string,
  options: WebsiteStudioRequestOptions = {},
): Promise<T> {
  if (!studioConfigured()) throw new WebsiteStudioError("unconfigured");

  const headers: Record<string, string> = {
    accept: "application/json",
    "x-meridian-studio-token": config.websiteStudioToken,
  };
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
    signal: AbortSignal.timeout(STUDIO_TIMEOUT_MS),
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(
      `${config.websiteStudioUrl}/api/studio${path}`,
      init,
    );
  } catch {
    throw new WebsiteStudioError("unavailable");
  }

  if (!response.ok) {
    throw new WebsiteStudioError("upstream", response.status);
  }

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new WebsiteStudioError("upstream", response.status);
  }
}
