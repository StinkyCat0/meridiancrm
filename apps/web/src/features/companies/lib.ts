import { ApiError } from "@meridian/api-client";
import { INDUSTRIES, type Industry } from "@meridian/contracts";

export const TAG_LIMIT = 12;

/** Narrows free-form API values to the industry enum used by selects and filters. */
export function toIndustry(value: string | null | undefined): Industry | "" {
  if (!value) return "";
  for (const option of INDUSTRIES) {
    if (option === value) return option;
  }
  return "";
}

/** Turns a comma-separated input into the API's tag array shape. */
export function parseTags(value: string): string[] {
  const tags = value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return Array.from(new Set(tags)).slice(0, TAG_LIMIT);
}

export function tagsToInput(tags: string[]): string {
  return tags.join(", ");
}

function validationDetails(details: unknown): string | null {
  if (
    typeof details !== "object" ||
    details === null ||
    !("fieldErrors" in details)
  ) {
    return null;
  }
  const fieldErrors: unknown = details.fieldErrors;
  if (typeof fieldErrors !== "object" || fieldErrors === null) return null;

  const messages: string[] = [];
  for (const [field, value] of Object.entries(fieldErrors)) {
    if (!Array.isArray(value)) continue;
    for (const message of value) {
      if (typeof message === "string" && message.trim()) {
        messages.push(`${field}: ${message}`);
      }
    }
  }
  return messages.length ? messages.join(" · ") : null;
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = validationDetails(error.details);
    return detail ? `${error.message} ${detail}` : error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}
