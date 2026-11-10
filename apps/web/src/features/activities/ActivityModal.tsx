import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  api,
  ApiError,
  type Activity,
  type ActivityType,
  type CreateActivityInput,
} from "@meridian/api-client";
import { ACTIVITY_TYPES, ACTIVITY_TYPE_META } from "@meridian/contracts";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { Textarea } from "../../components/ui/Textarea";
import { queryKeys } from "../../lib/query";
import { RelationCombobox, type RelationOption } from "./RelationCombobox";

async function loadCompanies(query: string): Promise<RelationOption[]> {
  const page = await api.companies.list({
    q: query || undefined,
    pageSize: 100,
    archive: "active",
  });
  return page.data.map((company) => ({
    id: company.id,
    label: company.name,
    hint: company.domain ?? undefined,
  }));
}

async function loadContacts(query: string): Promise<RelationOption[]> {
  const page = await api.contacts.list({
    q: query || undefined,
    pageSize: 100,
    archive: "active",
  });
  return page.data.map((contact) => ({
    id: contact.id,
    label: `${contact.firstName} ${contact.lastName}`.trim(),
    hint: contact.company?.name ?? contact.email ?? undefined,
  }));
}

async function loadDeals(query: string): Promise<RelationOption[]> {
  const page = await api.deals.list({
    q: query || undefined,
    pageSize: 100,
    status: "all",
  });
  return page.data.map((deal) => ({
    id: deal.id,
    label: deal.title,
    hint: deal.company?.name ?? deal.stage.name,
  }));
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

interface ActivityModalProps {
  open: boolean;
  activity: Activity | null;
  onClose: () => void;
}

export function ActivityModal({ open, activity, onClose }: ActivityModalProps) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<ActivityType>("TASK");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [companyLabel, setCompanyLabel] = useState("");
  const [contactLabel, setContactLabel] = useState("");
  const [dealLabel, setDealLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType(activity?.type ?? "TASK");
    setTitle(activity?.title ?? "");
    setBody(activity?.body ?? "");
    setDueAt(activity?.dueAt ? format(new Date(activity.dueAt), "yyyy-MM-dd'T'HH:mm") : "");
    setCompanyId(activity?.company?.id ?? null);
    setContactId(activity?.contact?.id ?? null);
    setDealId(activity?.dealId ?? null);
    setCompanyLabel(activity?.company?.name ?? "");
    setContactLabel(
      activity?.contact
        ? `${activity.contact.firstName} ${activity.contact.lastName}`.trim()
        : "",
    );
    setDealLabel(activity?.dealTitle ?? "");
    setError(null);
    setPending(false);
  }, [open, activity?.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Add a title so the activity is findable.");
      return;
    }

    let dueIso: string | null = null;
    if (dueAt) {
      const parsed = new Date(dueAt);
      if (Number.isNaN(parsed.getTime())) {
        setError("Enter a valid due date and time.");
        return;
      }
      dueIso = parsed.toISOString();
    }

    const payload: CreateActivityInput = {
      type,
      title: trimmedTitle,
      body: body.trim() || null,
      dueAt: dueIso,
      companyId,
      contactId,
      dealId,
    };

    setPending(true);
    try {
      if (activity) {
        await api.activities.update(activity.id, payload);
      } else {
        await api.activities.create(payload);
      }
      toast.success(activity ? "Activity updated" : "Activity logged");
      await queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      await queryClient.invalidateQueries({ queryKey: ["insights"] });
      await queryClient.invalidateQueries({ queryKey: ["workspace", "audit"] });
      onClose();
    } catch (cause) {
      const message = messageFor(cause, "Could not save the activity. Try again.");
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={activity ? "Edit activity" : "Log activity"}
      description={
        activity
          ? "Update the record, reschedule it, or change the linked deal."
          : "Capture a note, call, meeting, email or task against the workspace."
      }
      size="lg"
      closeOnBackdrop={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="activity-form" variant="primary" loading={pending}>
            {activity ? "Save changes" : "Log activity"}
          </Button>
        </>
      }
    >
      <form id="activity-form" className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="activity-type">
            <Select
              id="activity-type"
              value={type}
              onChange={(event) => setType(event.target.value as ActivityType)}
            >
              {ACTIVITY_TYPES.map((option) => (
                <option key={option} value={option}>
                  {ACTIVITY_TYPE_META[option].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due" htmlFor="activity-due" hint="Local time.">
            <Input
              id="activity-due"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </Field>
        </div>

        <Field label="Title" htmlFor="activity-title" required>
          <Input
            id="activity-title"
            value={title}
            maxLength={160}
            placeholder="Send the revised proposal"
            autoFocus
            data-autofocus
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>

        <Field label="Body" htmlFor="activity-body">
          <Textarea
            id="activity-body"
            rows={3}
            value={body}
            maxLength={5000}
            placeholder="Context, next steps, or notes…"
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <RelationCombobox
            id="activity-company"
            label="Company"
            source="company"
            value={companyId}
            initialLabel={companyLabel}
            onChange={setCompanyId}
            load={loadCompanies}
            placeholder="Search companies"
          />
          <RelationCombobox
            id="activity-contact"
            label="Contact"
            source="contact"
            value={contactId}
            initialLabel={contactLabel}
            onChange={setContactId}
            load={loadContacts}
            placeholder="Search contacts"
          />
          <div className="sm:col-span-2">
            <RelationCombobox
              id="activity-deal"
              label="Deal"
              source="deal"
              value={dealId}
              initialLabel={dealLabel}
              onChange={setDealId}
              load={loadDeals}
              placeholder="Search deals"
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm leading-relaxed text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
