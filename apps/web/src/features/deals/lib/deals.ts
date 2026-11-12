import { ApiError } from "@meridian/api-client";
import type { Deal, Momentum, StageKind } from "@meridian/contracts";
import { isBefore, isValid, parseISO, startOfDay } from "date-fns";
import type { BadgeTone } from "../../../components/ui";

export interface MomentumMeta {
  label: string;
  tone: BadgeTone;
  bar: string;
  text: string;
  description: string;
}

export const momentumMeta: Record<Momentum["band"], MomentumMeta> = {
  hot: {
    label: "Hot",
    tone: "danger",
    bar: "bg-danger",
    text: "text-danger",
    description:
      "Recent activity, healthy stage time, and a close date that still holds.",
  },
  warm: {
    label: "Warm",
    tone: "warning",
    bar: "bg-warning",
    text: "text-warning",
    description:
      "Some signals are fading. A touchpoint or stage update will lift momentum.",
  },
  cold: {
    label: "Cold",
    tone: "accent",
    bar: "bg-accent",
    text: "text-accent",
    description:
      "Little recent activity or a stalled stage. Re-engage before the close date slips.",
  },
};

export function stageKindTone(kind: StageKind): BadgeTone {
  if (kind === "WON") return "success";
  if (kind === "LOST") return "danger";
  return "neutral";
}

export function stageKindLabel(kind: StageKind): string | null {
  if (kind === "WON") return "Won";
  if (kind === "LOST") return "Lost";
  return null;
}

/** A close date only counts as overdue while the deal is still open. */
export function isOverdue(date: string | null, kind: StageKind): boolean {
  if (!date || kind !== "OPEN") return false;
  const parsed = parseISO(date);
  return isValid(parsed) && isBefore(parsed, startOfDay(new Date()));
}

export function dealSubtitle(deal: Deal): string {
  const contact = deal.contact
    ? `${deal.contact.firstName} ${deal.contact.lastName}`
    : null;
  if (deal.company && contact) return `${deal.company.name} · ${contact}`;
  return deal.company?.name ?? contact ?? "No company";
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}
