import { ApiError } from "@meridian/api-client";
import { registerSchema } from "@meridian/contracts";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { useAuth } from "../../lib/auth";
import { AuthLayout } from "./AuthLayout";
import { PasswordInput } from "./PasswordInput";

type RegisterField = "name" | "workspaceName" | "email" | "password";
type FieldErrors = Partial<Record<RegisterField, string>>;

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<RegisterField, string>>({
    name: "",
    workspaceName: "",
    email: "",
    password: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function update(field: RegisterField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = registerSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrors({
        name: fieldErrors.name?.[0],
        workspaceName: fieldErrors.workspaceName?.[0],
        email: fieldErrors.email?.[0],
        password: fieldErrors.password?.[0],
      });
      return;
    }

    setErrors({});
    setPending(true);
    try {
      await register(parsed.data);
      navigate("/app", { replace: true });
    } catch (cause) {
      setFormError(
        cause instanceof ApiError
          ? cause.message
          : "Account creation failed. Check your connection and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-8">
        <p className="label-micro">New workspace</p>
        <h1 className="mt-2 text-3xl font-light tracking-tight text-fg">Create your studio</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          One workspace, built for the way boutique teams work.
        </p>
      </div>

      <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Field label="Your name" htmlFor="register-name" error={errors.name} required>
          <Input
            id="register-name"
            name="name"
            autoComplete="name"
            placeholder="Avery Stone"
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            invalid={Boolean(errors.name)}
            required
          />
        </Field>

        <Field label="Workspace name" htmlFor="register-workspace" error={errors.workspaceName} required>
          <Input
            id="register-workspace"
            name="workspaceName"
            autoComplete="organization"
            placeholder="Meridian Studio"
            value={values.workspaceName}
            onChange={(event) => update("workspaceName", event.target.value)}
            invalid={Boolean(errors.workspaceName)}
            required
          />
        </Field>

        <Field label="Email" htmlFor="register-email" error={errors.email} required>
          <Input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@studio.com"
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
            invalid={Boolean(errors.email)}
            required
          />
        </Field>

        <Field
          label="Password"
          htmlFor="register-password"
          error={errors.password}
          hint="10+ characters, with at least one letter and one number."
          required
        >
          <PasswordInput
            id="register-password"
            name="password"
            autoComplete="new-password"
            placeholder="Choose a password"
            value={values.password}
            onChange={(event) => update("password", event.target.value)}
            invalid={Boolean(errors.password)}
            required
          />
        </Field>

        {formError ? (
          <p role="alert" className="text-sm leading-relaxed text-danger">
            {formError}
          </p>
        ) : null}

        <Button type="submit" variant="primary" fullWidth loading={pending}>
          Create workspace
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-muted">
        Already have a workspace?{" "}
        <Link
          to="/login"
          className="font-medium text-fg underline decoration-border underline-offset-4 transition-colors hover:text-accent hover:decoration-accent/40"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
