import { api, type CreateCompanyInput } from "@meridian/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { INDUSTRIES, type Company, type Industry } from "@meridian/contracts";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { Textarea } from "../../components/ui/Textarea";
import { queryKeys } from "../../lib/query";
import { apiErrorMessage, parseTags, tagsToInput, toIndustry } from "./lib";

interface CompanyFormModalProps {
  company?: Company | null;
  onClose: () => void;
  onSaved: (company: Company) => void;
}

interface FormErrors {
  name?: string;
}

export function CompanyFormModal({ company, onClose, onSaved }: CompanyFormModalProps) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [name, setName] = useState(company?.name ?? "");
  const [domain, setDomain] = useState(company?.domain ?? "");
  const [industry, setIndustry] = useState<Industry | "">(
    toIndustry(company?.industry),
  );
  const [size, setSize] = useState(company?.size ?? "");
  const [phone, setPhone] = useState(company?.phone ?? "");
  const [website, setWebsite] = useState(company?.website ?? "");
  const [address, setAddress] = useState(company?.address ?? "");
  const [tags, setTags] = useState(tagsToInput(company?.tags ?? []));
  const [notes, setNotes] = useState(company?.notes ?? "");
  const [errors, setErrors] = useState<FormErrors>({});

  const save = useMutation({
    mutationFn: (input: CreateCompanyInput) =>
      company ? api.companies.update(company.id, input) : api.companies.create(input),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      toast.success(company ? "Company updated" : "Company created");
      onSaved(saved);
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    if (!name.trim()) {
      setErrors({ name: "Company name is required." });
      return;
    }
    setErrors({});
    save.mutate({
      name: name.trim(),
      domain: domain.trim() || null,
      industry: industry || null,
      size: size.trim() || null,
      phone: phone.trim() || null,
      website: website.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
      tags: parseTags(tags),
    });
  }

  const heading = company ? `Edit ${company.name}` : "New company";
  const id = (field: string) => `${formId}-${field}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={heading}
      description="The account record behind the people and the pipeline."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={save.isPending}>
            {company ? "Save company" : "Create company"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field label="Name" htmlFor={id("name")} required error={errors.name}>
          <Input
            id={id("name")}
            data-autofocus
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (errors.name) setErrors({});
            }}
            invalid={Boolean(errors.name)}
            maxLength={160}
            placeholder="Meridian Studio"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Domain" htmlFor={id("domain")}>
            <Input
              id={id("domain")}
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              maxLength={200}
              placeholder="meridian.studio"
            />
          </Field>
          <Field label="Industry" htmlFor={id("industry")}>
            <Select
              id={id("industry")}
              value={industry}
              onChange={(event) => setIndustry(toIndustry(event.target.value))}
            >
              <option value="">No industry</option>
              {INDUSTRIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Size" htmlFor={id("size")}>
            <Input
              id={id("size")}
              value={size}
              onChange={(event) => setSize(event.target.value)}
              maxLength={40}
              placeholder="11–50"
            />
          </Field>
          <Field label="Phone" htmlFor={id("phone")}>
            <Input
              id={id("phone")}
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              maxLength={40}
              placeholder="+1 415 555 0190"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Website" htmlFor={id("website")} hint="Include https://">
            <Input
              id={id("website")}
              type="url"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              maxLength={500}
              placeholder="https://meridian.studio"
            />
          </Field>
          <Field label="Address" htmlFor={id("address")}>
            <Input
              id={id("address")}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              maxLength={300}
              placeholder="18 Mercer Street, New York"
            />
          </Field>
        </div>

        <Field label="Tags" htmlFor={id("tags")} hint="Comma separated, up to 12 tags.">
          <Input
            id={id("tags")}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="retainer, design system, warm"
          />
        </Field>

        <Field label="Notes" htmlFor={id("notes")}>
          <Textarea
            id={id("notes")}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={5000}
            placeholder="Context worth keeping close."
            rows={4}
          />
        </Field>
      </form>
    </Modal>
  );
}
