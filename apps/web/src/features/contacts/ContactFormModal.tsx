import { api, type CreateContactInput } from "@meridian/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import type { Company, Contact } from "@meridian/contracts";
import { queryKeys } from "../../lib/query";
import { apiErrorMessage, contactName, parseTags, tagsToInput } from "./lib";

interface ContactFormModalProps {
  contact?: Contact | null;
  companies: Company[];
  onClose: () => void;
  onSaved: (contact: Contact) => void;
}

interface FormErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ContactFormModal({
  contact,
  companies,
  onClose,
  onSaved,
}: ContactFormModalProps) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [firstName, setFirstName] = useState(contact?.firstName ?? "");
  const [lastName, setLastName] = useState(contact?.lastName ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [title, setTitle] = useState(contact?.title ?? "");
  const [companyId, setCompanyId] = useState(contact?.company?.id ?? "");
  const [tags, setTags] = useState(tagsToInput(contact?.tags ?? []));
  const [errors, setErrors] = useState<FormErrors>({});

  const companyOptions: Array<{ id: string; name: string }> = companies.map(
    (company) => ({
      id: company.id,
      name: company.name,
    }),
  );
  const currentCompany = contact?.company ?? null;
  if (
    currentCompany &&
    !companyOptions.some((option) => option.id === currentCompany.id)
  ) {
    companyOptions.unshift({
      id: currentCompany.id,
      name: currentCompany.name,
    });
  }

  const save = useMutation({
    mutationFn: (input: CreateContactInput) =>
      contact
        ? api.contacts.update(contact.id, input)
        : api.contacts.create(input),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      toast.success(contact ? "Contact updated" : "Contact created");
      onSaved(saved);
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  function validate(): boolean {
    const next: FormErrors = {};
    if (!firstName.trim()) next.firstName = "First name is required.";
    if (!lastName.trim()) next.lastName = "Last name is required.";
    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
      next.email = "Enter a valid email address.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    if (!validate()) return;

    save.mutate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      title: title.trim() || null,
      companyId: companyId || null,
      tags: parseTags(tags),
    });
  }

  const heading = contact ? `Edit ${contactName(contact)}` : "New contact";
  const id = (field: string) => `${formId}-${field}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={heading}
      description="Keep the record precise — names are required, everything else can grow over time."
      size="lg"
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
            {contact ? "Save contact" : "Create contact"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={handleSubmit}
        noValidate
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="First name"
            htmlFor={id("firstName")}
            required
            error={errors.firstName}
          >
            <Input
              id={id("firstName")}
              data-autofocus
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              invalid={Boolean(errors.firstName)}
              maxLength={80}
              autoComplete="given-name"
              placeholder="Avery"
            />
          </Field>
          <Field
            label="Last name"
            htmlFor={id("lastName")}
            required
            error={errors.lastName}
          >
            <Input
              id={id("lastName")}
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              invalid={Boolean(errors.lastName)}
              maxLength={80}
              autoComplete="family-name"
              placeholder="Meridian"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" htmlFor={id("email")} error={errors.email}>
            <Input
              id={id("email")}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              invalid={Boolean(errors.email)}
              maxLength={254}
              autoComplete="email"
              placeholder="avery@studio.com"
            />
          </Field>
          <Field label="Phone" htmlFor={id("phone")}>
            <Input
              id={id("phone")}
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              maxLength={40}
              autoComplete="tel"
              placeholder="+1 415 555 0134"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor={id("title")}>
            <Input
              id={id("title")}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="Creative Director"
            />
          </Field>
          <Field label="Company" htmlFor={id("company")}>
            <Select
              id={id("company")}
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
            >
              <option value="">No company</option>
              {companyOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Tags"
          htmlFor={id("tags")}
          hint="Comma separated, up to 12 tags."
        >
          <Input
            id={id("tags")}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="design, retainer, warm"
          />
        </Field>
      </form>
    </Modal>
  );
}
