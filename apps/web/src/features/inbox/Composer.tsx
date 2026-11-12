import {
  api,
  type CommunicationChannel,
  type CommunicationDraft,
  type CommunicationIntent,
  type CommunicationThread,
  type CreateCommunicationInput,
} from "@meridian/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Send, Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  COMMUNICATION_CHANNEL_META,
  COMMUNICATION_INTENTS,
  COMMUNICATION_INTENT_META,
} from "@meridian/contracts";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Textarea } from "../../components/ui/Textarea";
import { queryKeys } from "../../lib/query";
import { cn } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";

type Customer = CommunicationThread["customer"];

const COMPOSER_CHANNELS: readonly CommunicationChannel[] = [
  "SMS",
  "EMAIL",
  "CALL",
];

interface ComposerProps {
  customer: Customer;
  className?: string;
}

interface FormErrors {
  body?: string;
  subject?: string;
}

/** A call log cannot be sent anywhere; these are the only outcomes we record. */
type CallOutcome = "RECEIVED" | "MISSED";

function callBody(duration: string, notes: string): string {
  const sections: string[] = [];
  const minutes = duration.trim();
  if (minutes) sections.push(`Duration: ${minutes} min`);
  const trimmedNotes = notes.trim();
  if (trimmedNotes) sections.push(trimmedNotes);
  return sections.join("\n\n");
}

export function Composer({ customer, className }: ComposerProps) {
  const queryClient = useQueryClient();
  const uid = useId();
  const [channel, setChannel] = useState<CommunicationChannel>("SMS");
  const [intent, setIntent] = useState<CommunicationIntent>("FOLLOW_UP");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [callOutcome, setCallOutcome] = useState<CallOutcome>("RECEIVED");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<CommunicationDraft | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});

  const isCall = channel === "CALL";

  function resetForm() {
    setSubject("");
    setBody("");
    setDuration("");
    setNotes("");
    setDraft(null);
    setErrors({});
  }

  function handleChannelChange(next: CommunicationChannel) {
    if (next === channel) return;
    setChannel(next);
    setErrors({});
    // A draft written for a text does not carry over as a call log, and the
    // assistant only drafts messages, so attach attribution is dropped.
    setDraft(null);
  }

  const draftMutation = useMutation({
    mutationFn: () =>
      api.communications.draft({
        customerId: customer.id,
        channel,
        intent,
      }),
    onSuccess: (result) => {
      setChannel(result.channel);
      setIntent(result.intent);
      setSubject(result.subject ?? "");
      setBody(result.body);
      setDraft(result);
      setErrors({});
      toast.success("Draft ready — review before logging.");
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateCommunicationInput) =>
      api.communications.create(input),
    onSuccess: (_created, input) => {
      toast.success(
        input.channel === "CALL"
          ? "Call logged in the inbox."
          : "Message logged in the inbox. No carrier is connected, so nothing was delivered.",
      );
      resetForm();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.communications.all,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.companies.timeline(customer.id),
      });
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  function submit() {
    const nextErrors: FormErrors = {};
    if (isCall) {
      if (!notes.trim() && !duration.trim()) {
        nextErrors.body =
          "Add how long the call lasted or a short note about it.";
      } else if (duration.trim()) {
        const minutes = Number(duration);
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
          nextErrors.body = "Enter a call duration between 0 and 1440 minutes.";
        }
      }
    } else if (!body.trim()) {
      nextErrors.body = "Write the message before logging it.";
    }
    if (!isCall && channel === "EMAIL" && subject.trim().length > 200) {
      nextErrors.subject = "Keep the subject under 200 characters.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const messageBody = (
      isCall ? callBody(duration, notes) : body.trim()
    ).slice(0, 5000);
    const input: CreateCommunicationInput = {
      channel,
      direction: "OUTBOUND",
      // There is no delivery provider: texts and emails are simply logged.
      status: isCall ? callOutcome : "LOGGED",
      intent,
      subject:
        !isCall && channel === "EMAIL" && subject.trim()
          ? subject.trim()
          : null,
      body: messageBody,
      customerId: customer.id,
      occurredAt: new Date().toISOString(),
      aiGenerated: draft !== null,
      aiRationale: draft ? draft.rationale.slice(0, 500) : null,
    };
    createMutation.mutate(input);
  }

  const busy = createMutation.isPending || draftMutation.isPending;

  return (
    <section
      className={cn(
        "border-t border-border bg-surface/60 p-4 sm:p-5",
        className,
      )}
      aria-label={`Log a message for ${customer.name}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-fg">Log an interaction</h2>
          <p className="mt-0.5 text-xs text-muted">
            Stored in this workspace only — no carrier or mailbox is connected.
          </p>
        </div>
        <Badge tone="neutral" className="shrink-0">
          Local inbox
        </Badge>
      </div>

      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Channel" htmlFor={`${uid}-channel`}>
            <Select
              id={`${uid}-channel`}
              value={channel}
              onChange={(event) =>
                handleChannelChange(event.target.value as CommunicationChannel)
              }
            >
              {COMPOSER_CHANNELS.map((option) => (
                <option key={option} value={option}>
                  {option === "CALL"
                    ? "Call log"
                    : COMMUNICATION_CHANNEL_META[option].label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Intent" htmlFor={`${uid}-intent`}>
            <Select
              id={`${uid}-intent`}
              value={intent}
              onChange={(event) =>
                setIntent(event.target.value as CommunicationIntent)
              }
            >
              {COMMUNICATION_INTENTS.map((option) => (
                <option key={option} value={option}>
                  {COMMUNICATION_INTENT_META[option]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {isCall ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Call outcome" htmlFor={`${uid}-outcome`}>
                <Select
                  id={`${uid}-outcome`}
                  value={callOutcome}
                  onChange={(event) =>
                    setCallOutcome(event.target.value as CallOutcome)
                  }
                >
                  <option value="RECEIVED">Received / connected</option>
                  <option value="MISSED">Missed</option>
                </Select>
              </Field>
              <Field
                label="Duration"
                htmlFor={`${uid}-duration`}
                hint="Minutes. Leave blank if you were not connected."
              >
                <Input
                  id={`${uid}-duration`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={1440}
                  step={1}
                  value={duration}
                  onChange={(event) => {
                    setDuration(event.target.value);
                    setErrors((current) => ({ ...current, body: undefined }));
                  }}
                  placeholder="12"
                />
              </Field>
            </div>
            <Field
              label="Call notes"
              htmlFor={`${uid}-notes`}
              error={errors.body}
              hint="What was discussed, or why the call was missed."
            >
              <Textarea
                id={`${uid}-notes`}
                rows={3}
                maxLength={5000}
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                  setErrors((current) => ({ ...current, body: undefined }));
                }}
                placeholder="Left a voicemail about Thursday's appointment."
              />
            </Field>
          </>
        ) : (
          <>
            {channel === "EMAIL" ? (
              <Field
                label="Subject"
                htmlFor={`${uid}-subject`}
                error={errors.subject}
              >
                <Input
                  id={`${uid}-subject`}
                  maxLength={200}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Your appointment this week"
                />
              </Field>
            ) : null}
            <Field
              label={channel === "SMS" ? "Text message" : "Email body"}
              htmlFor={`${uid}-body`}
              error={errors.body}
            >
              <Textarea
                id={`${uid}-body`}
                rows={4}
                maxLength={5000}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  setErrors((current) => ({ ...current, body: undefined }));
                }}
                placeholder={
                  channel === "SMS"
                    ? "Hi Alex, just confirming your visit tomorrow at 9."
                    : "Hi Alex, a quick note about your upcoming visit…"
                }
              />
            </Field>
          </>
        )}

        {draft ? (
          <div className="rounded-input border border-accent-2/25 bg-accent-2/[0.06] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="violet">
                <Sparkles className="size-3" aria-hidden="true" />
                AI-assisted
              </Badge>
              <Badge tone="neutral">Local engine</Badge>
              <span className="text-[11px] text-muted">
                Drafted on this server — no external AI service was called.
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              <span className="font-medium text-fg">Why this draft:</span>{" "}
              {draft.rationale}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            {!isCall ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => draftMutation.mutate()}
              >
                {draftMutation.isPending ? (
                  <Loader2
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Sparkles className="size-3.5" aria-hidden="true" />
                )}
                Draft with assistant
              </Button>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Assistant drafts texts and emails only.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {draft || body || subject || notes || duration ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={resetForm}
              >
                Clear
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              type="submit"
              loading={createMutation.isPending}
            >
              <Send className="size-3.5" aria-hidden="true" />
              {isCall
                ? "Log call"
                : channel === "SMS"
                  ? "Log text"
                  : "Log email"}
            </Button>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-muted">
          Nothing is sent to the customer. This records the interaction for your
          team and the customer timeline.
        </p>
      </form>
    </section>
  );
}
