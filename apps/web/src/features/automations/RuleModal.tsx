import {
  api,
  type AutomationAction,
  type AutomationConditions,
  type AutomationRule,
  type CreateAutomationInput,
} from "@meridian/api-client";
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_TRIGGERS,
  AUTOMATION_TRIGGER_META,
  COMMUNICATION_CHANNEL_META,
  COMMUNICATION_CHANNELS,
  COMMUNICATION_INTENT_META,
  COMMUNICATION_INTENTS,
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_META,
  JOB_PRIORITIES,
  JOB_PRIORITY_META,
  type AutomationActionType,
  type AutomationTrigger,
  type CommunicationChannel,
  type CommunicationIntent,
  type CustomerType,
  type JobPriority,
} from "@meridian/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { Textarea } from "../../components/ui/Textarea";
import { queryKeys } from "../../lib/query";
import { fromCents, toCents } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";

export const ACTION_LABELS: Record<AutomationActionType, string> = {
  CREATE_TASK: "Create task",
  SEND_MESSAGE: "Send message",
  ADD_TAG: "Add tag",
  REQUEST_REVIEW: "Request review",
};

type ActionDraft =
  | { type: "CREATE_TASK"; title: string; body: string; dueInHours: string }
  | {
      type: "SEND_MESSAGE";
      channel: CommunicationChannel;
      intent: CommunicationIntent;
      body: string;
    }
  | { type: "ADD_TAG"; tag: string }
  | { type: "REQUEST_REVIEW"; channel: CommunicationChannel };

interface FormErrors {
  name?: string;
  minTotal?: string;
  actions: Record<number, string>;
}

function defaultAction(type: AutomationActionType): ActionDraft {
  switch (type) {
    case "CREATE_TASK":
      return { type, title: "", body: "", dueInHours: "24" };
    case "SEND_MESSAGE":
      return { type, channel: "SMS", intent: "FOLLOW_UP", body: "" };
    case "ADD_TAG":
      return { type, tag: "" };
    case "REQUEST_REVIEW":
      return { type, channel: "SMS" };
  }
  throw new Error(`Unsupported automation action: ${String(type)}`);
}

function draftFromAction(action: AutomationAction): ActionDraft {
  switch (action.type) {
    case "CREATE_TASK":
      return {
        type: action.type,
        title: action.title,
        body: action.body ?? "",
        dueInHours: String(action.dueInHours ?? 24),
      };
    case "SEND_MESSAGE":
      return {
        type: action.type,
        channel: action.channel,
        intent: action.intent,
        body: action.body ?? "",
      };
    case "ADD_TAG":
      return { type: action.type, tag: action.tag };
    case "REQUEST_REVIEW":
      return { type: action.type, channel: action.channel };
  }
  throw new Error("Unsupported automation action");
}

function serializeAction(draft: ActionDraft): AutomationAction {
  switch (draft.type) {
    case "CREATE_TASK":
      return {
        type: draft.type,
        title: draft.title.trim(),
        body: draft.body.trim() || null,
        dueInHours: Number(draft.dueInHours) || 24,
      };
    case "SEND_MESSAGE":
      return {
        type: draft.type,
        channel: draft.channel,
        intent: draft.intent,
        body: draft.body.trim() || null,
      };
    case "ADD_TAG":
      return { type: draft.type, tag: draft.tag.trim() };
    case "REQUEST_REVIEW":
      return { type: draft.type, channel: draft.channel };
  }
  throw new Error("Unsupported automation action");
}

interface RuleModalProps {
  rule: AutomationRule | null;
  onClose: () => void;
  onSaved: (rule: AutomationRule) => void;
}

export function RuleModal({ rule, onClose, onSaved }: RuleModalProps) {
  const queryClient = useQueryClient();
  const formId = useId();

  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    rule?.trigger ?? "JOB_COMPLETED",
  );
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [minTotal, setMinTotal] = useState(
    rule && rule.conditions.minTotal !== undefined
      ? fromCents(rule.conditions.minTotal)
      : "",
  );
  const [customerTypes, setCustomerTypes] = useState<CustomerType[]>(
    rule?.conditions.customerTypes ?? [],
  );
  const [priorities, setPriorities] = useState<JobPriority[]>(
    rule?.conditions.priorities ?? [],
  );
  const [actions, setActions] = useState<ActionDraft[]>(() =>
    rule ? rule.actions.map(draftFromAction) : [defaultAction("CREATE_TASK")],
  );
  const [errors, setErrors] = useState<FormErrors>({ actions: {} });

  const save = useMutation({
    mutationFn: (input: CreateAutomationInput) =>
      rule
        ? api.automations.update(rule.id, input)
        : api.automations.create(input),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.automations.all,
      });
      toast.success(rule ? "Automation updated" : "Automation created");
      onSaved(saved);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  function patchAction(index: number, next: ActionDraft) {
    setActions((current) =>
      current.map((action, i) => (i === index ? next : action)),
    );
    setErrors((current) => {
      if (!current.actions[index]) return current;
      const remaining = { ...current.actions };
      delete remaining[index];
      return { ...current, actions: remaining };
    });
  }

  function toggleCustomerType(value: CustomerType) {
    setCustomerTypes((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value].slice(0, CUSTOMER_TYPES.length),
    );
  }

  function togglePriority(value: JobPriority) {
    setPriorities((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value].slice(0, JOB_PRIORITIES.length),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;

    const nextErrors: FormErrors = { actions: {} };
    if (!name.trim()) nextErrors.name = "Give this automation a name.";

    const minTotalValue = Number(minTotal);
    if (
      minTotal.trim() &&
      (!Number.isFinite(minTotalValue) || minTotalValue < 0)
    ) {
      nextErrors.minTotal = "Enter a non-negative amount, or leave it blank.";
    }

    actions.forEach((action, index) => {
      if (action.type === "CREATE_TASK") {
        if (!action.title.trim()) {
          nextErrors.actions[index] = "Task automations need a title.";
          return;
        }
        const hours = Number(action.dueInHours);
        if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
          nextErrors.actions[index] =
            "Due within must be a whole number from 1 to 720 hours.";
        }
      }
      if (action.type === "ADD_TAG" && !action.tag.trim()) {
        nextErrors.actions[index] = "Add the tag this rule should apply.";
      }
    });

    if (
      nextErrors.name ||
      nextErrors.minTotal ||
      Object.keys(nextErrors.actions).length > 0
    ) {
      setErrors(nextErrors);
      return;
    }
    setErrors({ actions: {} });
    setName(name.trim());

    const conditions: AutomationConditions = {};
    if (minTotal.trim()) conditions.minTotal = toCents(minTotal);
    if (customerTypes.length > 0) conditions.customerTypes = customerTypes;
    if (priorities.length > 0) conditions.priorities = priorities;

    save.mutate({
      name: name.trim(),
      description: description.trim() || null,
      trigger,
      conditions,
      actions: actions.map(serializeAction),
      enabled,
    });
  }

  const id = (field: string) => `${formId}-${field}`;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={rule ? `Edit ${rule.name}` : "New automation"}
      description="Decide what happens, then let the workspace handle the follow-through."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            loading={save.isPending}
          >
            {rule ? "Save automation" : "Create automation"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={handleSubmit}
        noValidate
        className="space-y-6"
      >
        <div className="space-y-4">
          <Field label="Name" htmlFor={id("name")} required error={errors.name}>
            <Input
              id={id("name")}
              data-autofocus
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (errors.name)
                  setErrors((current) => ({ ...current, name: undefined }));
              }}
              invalid={Boolean(errors.name)}
              maxLength={120}
              placeholder="Follow up after a completed job"
            />
          </Field>

          <Field label="Description" htmlFor={id("description")}>
            <Textarea
              id={id("description")}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Why does this rule exist? Teammates will see this."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Trigger"
              htmlFor={id("trigger")}
              hint={`Fires when a ${AUTOMATION_TRIGGER_META[trigger].entity} matches.`}
            >
              <Select
                id={id("trigger")}
                value={trigger}
                onChange={(event) =>
                  setTrigger(event.target.value as AutomationTrigger)
                }
              >
                {AUTOMATION_TRIGGERS.map((value) => (
                  <option key={value} value={value}>
                    {AUTOMATION_TRIGGER_META[value].label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex flex-col justify-end">
              <label className="flex min-h-10 items-center gap-2.5 rounded-input border border-border bg-surface-2 px-3 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                  className="size-4 rounded border-border accent-accent"
                />
                Rule is enabled
              </label>
              <p className="mt-1.5 text-xs text-muted">
                Paused rules keep their history and can be resumed any time.
              </p>
            </div>
          </div>
        </div>

        <section
          className="space-y-3"
          aria-labelledby={id("conditions-heading")}
        >
          <div>
            <h3
              id={id("conditions-heading")}
              className="text-sm font-medium text-fg"
            >
              Conditions
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Optional. Narrow the rule to specific money values, customer types
              or job priorities.
            </p>
          </div>

          <Field
            label="Minimum job or invoice total"
            htmlFor={id("min-total")}
            hint="In major currency units. Leave blank to match every total."
            error={errors.minTotal}
          >
            <Input
              id={id("min-total")}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={minTotal}
              onChange={(event) => {
                setMinTotal(event.target.value);
                if (errors.minTotal) {
                  setErrors((current) => ({ ...current, minTotal: undefined }));
                }
              }}
              invalid={Boolean(errors.minTotal)}
              placeholder="0.00"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted">
                Customer types
              </legend>
              <div className="space-y-1.5 rounded-input border border-border bg-surface-2/40 p-3">
                {CUSTOMER_TYPES.map((value) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2 text-sm text-fg"
                  >
                    <input
                      type="checkbox"
                      checked={customerTypes.includes(value)}
                      onChange={() => toggleCustomerType(value)}
                      className="size-4 rounded border-border accent-accent"
                    />
                    {CUSTOMER_TYPE_META[value].label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted">
                Job priorities
              </legend>
              <div className="space-y-1.5 rounded-input border border-border bg-surface-2/40 p-3">
                {JOB_PRIORITIES.map((value) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2 text-sm text-fg"
                  >
                    <input
                      type="checkbox"
                      checked={priorities.includes(value)}
                      onChange={() => togglePriority(value)}
                      className="size-4 rounded border-border accent-accent"
                    />
                    {JOB_PRIORITY_META[value].label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>

        <section className="space-y-3" aria-labelledby={id("actions-heading")}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3
                id={id("actions-heading")}
                className="text-sm font-medium text-fg"
              >
                Actions
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Run one to five actions in order when the trigger matches.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setActions((current) => [
                  ...current,
                  defaultAction("CREATE_TASK"),
                ]);
                setErrors((current) => ({ ...current, actions: {} }));
              }}
              disabled={actions.length >= 5 || save.isPending}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add action
            </Button>
          </div>

          <div className="space-y-3">
            {actions.map((action, index) => {
              const error = errors.actions[index];
              return (
                <div
                  key={index}
                  className="space-y-3 rounded-card border border-border bg-surface-2/40 p-4"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                      Action {index + 1}
                    </p>
                    <div className="ml-auto">
                      <IconButton
                        label={`Remove action ${index + 1}`}
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setActions((current) =>
                            current.filter((_, i) => i !== index),
                          );
                          setErrors((current) => ({ ...current, actions: {} }));
                        }}
                        disabled={actions.length === 1 || save.isPending}
                      >
                        <Trash2 aria-hidden="true" />
                      </IconButton>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Type" htmlFor={id(`action-${index}-type`)}>
                      <Select
                        id={id(`action-${index}-type`)}
                        value={action.type}
                        onChange={(event) =>
                          patchAction(
                            index,
                            defaultAction(
                              event.target.value as AutomationActionType,
                            ),
                          )
                        }
                        aria-label={`Action ${index + 1} type`}
                      >
                        {AUTOMATION_ACTION_TYPES.map((value) => (
                          <option key={value} value={value}>
                            {ACTION_LABELS[value]}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    {action.type === "CREATE_TASK" ? (
                      <Field
                        label="Due within (hours)"
                        htmlFor={id(`action-${index}-hours`)}
                        hint="1 to 720 hours"
                      >
                        <Input
                          id={id(`action-${index}-hours`)}
                          type="number"
                          min="1"
                          max="720"
                          step="1"
                          value={action.dueInHours}
                          onChange={(event) =>
                            patchAction(index, {
                              ...action,
                              dueInHours: event.target.value,
                            })
                          }
                        />
                      </Field>
                    ) : null}

                    {action.type === "SEND_MESSAGE" ? (
                      <>
                        <Field
                          label="Channel"
                          htmlFor={id(`action-${index}-channel`)}
                        >
                          <Select
                            id={id(`action-${index}-channel`)}
                            value={action.channel}
                            onChange={(event) =>
                              patchAction(index, {
                                ...action,
                                channel: event.target
                                  .value as CommunicationChannel,
                              })
                            }
                            aria-label={`Action ${index + 1} channel`}
                          >
                            {COMMUNICATION_CHANNELS.map((value) => (
                              <option key={value} value={value}>
                                {COMMUNICATION_CHANNEL_META[value].label}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field
                          label="Intent"
                          htmlFor={id(`action-${index}-intent`)}
                        >
                          <Select
                            id={id(`action-${index}-intent`)}
                            value={action.intent}
                            onChange={(event) =>
                              patchAction(index, {
                                ...action,
                                intent: event.target
                                  .value as CommunicationIntent,
                              })
                            }
                            aria-label={`Action ${index + 1} intent`}
                          >
                            {COMMUNICATION_INTENTS.map((value) => (
                              <option key={value} value={value}>
                                {COMMUNICATION_INTENT_META[value]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </>
                    ) : null}

                    {action.type === "REQUEST_REVIEW" ? (
                      <Field
                        label="Channel"
                        htmlFor={id(`action-${index}-review-channel`)}
                      >
                        <Select
                          id={id(`action-${index}-review-channel`)}
                          value={action.channel}
                          onChange={(event) =>
                            patchAction(index, {
                              ...action,
                              channel: event.target
                                .value as CommunicationChannel,
                            })
                          }
                          aria-label={`Action ${index + 1} channel`}
                        >
                          {COMMUNICATION_CHANNELS.map((value) => (
                            <option key={value} value={value}>
                              {COMMUNICATION_CHANNEL_META[value].label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : null}
                  </div>

                  {action.type === "CREATE_TASK" ? (
                    <div className="space-y-3">
                      <Field
                        label="Task title"
                        htmlFor={id(`action-${index}-title`)}
                      >
                        <Input
                          id={id(`action-${index}-title`)}
                          value={action.title}
                          onChange={(event) =>
                            patchAction(index, {
                              ...action,
                              title: event.target.value,
                            })
                          }
                          maxLength={160}
                          invalid={Boolean(error)}
                          placeholder="Call the customer to book the next visit"
                        />
                      </Field>
                      <Field
                        label="Task notes"
                        htmlFor={id(`action-${index}-body`)}
                      >
                        <Textarea
                          id={id(`action-${index}-body`)}
                          value={action.body}
                          onChange={(event) =>
                            patchAction(index, {
                              ...action,
                              body: event.target.value,
                            })
                          }
                          maxLength={2000}
                          rows={2}
                          placeholder="Context the teammate needs"
                        />
                      </Field>
                    </div>
                  ) : null}

                  {action.type === "SEND_MESSAGE" ? (
                    <Field
                      label="Message"
                      htmlFor={id(`action-${index}-message`)}
                    >
                      <Textarea
                        id={id(`action-${index}-message`)}
                        value={action.body}
                        onChange={(event) =>
                          patchAction(index, {
                            ...action,
                            body: event.target.value,
                          })
                        }
                        maxLength={2000}
                        rows={3}
                        placeholder="Thanks for choosing us — anything else we can help with?"
                      />
                    </Field>
                  ) : null}

                  {action.type === "ADD_TAG" ? (
                    <Field label="Tag" htmlFor={id(`action-${index}-tag`)}>
                      <Input
                        id={id(`action-${index}-tag`)}
                        value={action.tag}
                        onChange={(event) =>
                          patchAction(index, {
                            ...action,
                            tag: event.target.value,
                          })
                        }
                        maxLength={30}
                        invalid={Boolean(error)}
                        placeholder="follow-up"
                      />
                    </Field>
                  ) : null}

                  {error ? (
                    <p role="alert" className="text-xs text-danger">
                      {error}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </form>
    </Modal>
  );
}
