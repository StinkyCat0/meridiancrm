import type { CommunicationDraft, DraftTone } from "./communications.js";
import type { CommunicationChannel, CommunicationIntent } from "./enums.js";

export interface DraftContext {
  customerName: string;
  contactName: string | null;
  businessName: string;
  businessTypeLabel: string;
  channel: CommunicationChannel;
  intent: CommunicationIntent;
  tone: DraftTone;
  appointmentLabel: string | null;
  jobNumber: string | null;
  serviceName: string | null;
  amountLabel: string | null;
  serviceArea: string | null;
}

const GREETING: Record<DraftTone, string> = {
  WARM: "Hi",
  PROFESSIONAL: "Hello",
  BRIEF: "Hi",
};

function signOff(tone: DraftTone, businessName: string): string {
  if (tone === "BRIEF") return businessName;
  if (tone === "PROFESSIONAL") return `Best regards,\n${businessName}`;
  return `Thanks,\n${businessName}`;
}

function appointmentLine(context: DraftContext): string {
  if (context.appointmentLabel) return ` for ${context.appointmentLabel}`;
  return "";
}

function serviceLine(context: DraftContext): string {
  if (context.serviceName && context.jobNumber) {
    return `${context.serviceName} (${context.jobNumber})`;
  }
  return context.serviceName ?? context.jobNumber ?? "upcoming visit";
}

function bodyFor(context: DraftContext): string {
  const name = context.contactName?.split(" ")[0] ?? context.customerName;
  const greeting = `${GREETING[context.tone]}, ${name} —`;
  const appointment = appointmentLine(context);
  const amount = context.amountLabel ? ` of ${context.amountLabel}` : "";

  switch (context.intent) {
    case "REMINDER":
      return `${greeting}\n\nA quick reminder about your ${serviceLine(context)}${appointment}. Reply here if you need to adjust the time or share access notes.`;
    case "FOLLOW_UP":
      return `${greeting}\n\nFollowing up on your ${serviceLine(context)}. We have a few openings this week and can hold a slot if you would like to book.`;
    case "QUOTE":
      return `${greeting}\n\nYour quote for ${serviceLine(context)} is ready${amount ? ` at ${amount}` : ""}. It is valid for 14 days, and I am happy to walk through the options.`;
    case "PAYMENT":
      return `${greeting}\n\nA friendly note that your balance${amount} is still open. You can pay from the invoice link, or reply if you would like to split it.`;
    case "REVIEW":
      return `${greeting}\n\nThanks for choosing ${context.businessName}${appointment ? ` on${appointment.replace(" for", "")}` : ""}. If the visit went well, a short review helps our local team more than you know.`;
    case "WINBACK":
      return `${greeting}\n\nIt has been a while since your last ${context.businessTypeLabel.toLowerCase()} visit. We kept your notes on file and would love to get you back on the schedule${context.serviceArea ? ` in ${context.serviceArea}` : ""}.`;
    case "RESCHEDULE":
      return `${greeting}\n\nWe need to move your ${serviceLine(context)}${appointment}. Reply with two times that work and we will confirm the first available slot.`;
    case "GENERAL":
      return `${greeting}\n\nChecking in on ${serviceLine(context)}. Let me know if anything has changed or if there is anything else we can take care of while we are there.`;
  }
}

function subjectFor(context: DraftContext): string | null {
  if (context.channel !== "EMAIL") return null;
  switch (context.intent) {
    case "REMINDER":
      return `Your ${context.businessTypeLabel.toLowerCase()} appointment`;
    case "QUOTE":
      return `Quote ready — ${context.serviceName ?? context.customerName}`;
    case "PAYMENT":
      return `Invoice reminder${context.amountLabel ? ` — ${context.amountLabel}` : ""}`;
    case "REVIEW":
      return "A quick favor after your visit";
    case "WINBACK":
      return "Ready for your next visit?";
    default:
      return `Following up — ${context.customerName}`;
  }
}

function rationaleFor(context: DraftContext): string {
  const parts = [`${context.intent.replaceAll("_", "-").toLowerCase()} intent`];
  if (context.appointmentLabel) parts.push("appointment context");
  if (context.amountLabel) parts.push("open balance");
  parts.push(`${context.tone.toLowerCase()} tone`);
  return `Generated from ${parts.join(", ")} using Meridian's local template engine. No customer data left the server.`;
}

/**
 * Local, deterministic drafting. It never calls a model or a carrier; the UI
 * labels it as an assistant draft until an agent reviews and sends it.
 */
export function buildMessageDraft(context: DraftContext): CommunicationDraft {
  return {
    channel: context.channel,
    intent: context.intent,
    subject: subjectFor(context),
    body: `${bodyFor(context)}\n\n${signOff(context.tone, context.businessName)}`,
    rationale: rationaleFor(context),
    tone: context.tone,
  };
}
