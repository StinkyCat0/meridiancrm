import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@meridian/api-client";
import { registerSchema } from "@meridian/contracts";
import { AlertCircle } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { AuthLayout } from "./AuthLayout";
import { PasswordInput } from "./PasswordInput";

interface InviteFieldErrors {
  name?: string;
  password?: string;
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const inviteToken = token ?? "";
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();

  const inviteQuery = useQuery({
    queryKey: queryKeys.auth.invite(inviteToken),
    queryFn: () => api.auth.getInvite(inviteToken),
    enabled: inviteToken.length > 0,
    retry: false,
  });

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<InviteFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const invite = inviteQuery.data;
  const status = inviteQuery.error instanceof ApiError ? inviteQuery.error.status : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const nameResult = registerSchema.shape.name.safeParse(name);
    const passwordResult = registerSchema.shape.password.safeParse(password);
    setErrors({
      name: nameResult.success ? undefined : nameResult.error.issues[0]?.message,
      password: passwordResult.success ? undefined : passwordResult.error.issues[0]?.message,
    });
    if (!nameResult.success || !passwordResult.success) return;

    setPending(true);
    try {
      await acceptInvite({ token: inviteToken, name: name.trim(), password });
      navigate("/app", { replace: true });
    } catch (cause) {
      setFormError(
        cause instanceof ApiError
          ? cause.message
          : "Could not accept the invitation. Check your connection and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  if (!inviteToken) {
    return (
      <AuthLayout>
        <InviteUnavailable
          title="Invitation not found"
          description="This link is incomplete. Ask your workspace admin for a fresh invitation."
        />
      </AuthLayout>
    );
  }

  if (inviteQuery.isPending) {
    return (
      <AuthLayout>
        <div className="space-y-4" role="status" aria-label="Loading invitation">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="mt-6 h-16 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthLayout>
    );
  }

  if (inviteQuery.isError || !invite) {
    // Retry a transient failure; invalid/expired/used invites stay terminal.
    const canRetry = status === null || status === 0 || status >= 500;
    const unavailable =
      status === 410
        ? {
            title: "Invitation expired",
            description:
              "This invitation is no longer valid. Ask your workspace admin to send a new one.",
          }
        : status === 409
          ? {
              title: "Invitation already used",
              description: "This invitation has been accepted. Sign in to continue.",
            }
          : status === 404
            ? {
                title: "Invitation not found",
                description: "This link is invalid or has been revoked.",
              }
            : {
                title: "Invitation unavailable",
                description:
                  "We could not load this invitation. Check your connection and try again.",
              };

    return (
      <AuthLayout>
        <InviteUnavailable
          title={unavailable.title}
          description={unavailable.description}
          action={
            canRetry ? (
              <Button onClick={() => void inviteQuery.refetch()}>Try again</Button>
            ) : null
          }
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-8">
        <p className="label-micro">Invitation</p>
        <h1 className="mt-2 text-3xl font-light tracking-tight text-fg">
          Join {invite.workspaceName}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Set your name and a password to enter the workspace.
        </p>
      </div>

      <div className="mb-5 rounded-card border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="label-micro">Invited</span>
          <Badge tone="accent">{invite.role}</Badge>
        </div>
        <p className="mt-2 truncate text-sm font-medium text-fg">{invite.email}</p>
        <p className="mt-1 text-xs text-muted">
          {invite.invitedByName ? `Invited by ${invite.invitedByName}` : "Workspace invitation"}
        </p>
      </div>

      <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Field label="Your name" htmlFor="invite-name" error={errors.name} required>
          <Input
            id="invite-name"
            name="name"
            autoComplete="name"
            placeholder="Avery Stone"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
            }}
            invalid={Boolean(errors.name)}
            required
          />
        </Field>

        <Field
          label="Password"
          htmlFor="invite-password"
          error={errors.password}
          hint="10+ characters, with at least one letter and one number."
          required
        >
          <PasswordInput
            id="invite-password"
            name="password"
            autoComplete="new-password"
            placeholder="Choose a password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
            }}
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
          Accept invitation
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-muted">
        Already a member?{" "}
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

function InviteUnavailable({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div>
      <span
        className="mb-5 flex size-10 items-center justify-center rounded-full border border-danger/25 bg-danger/10 text-danger"
        aria-hidden="true"
      >
        <AlertCircle className="size-5" />
      </span>
      <h1 className="text-2xl font-light tracking-tight text-fg">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
      <p className="mt-8 text-sm text-muted">
        <Link
          to="/login"
          className="font-medium text-fg underline decoration-border underline-offset-4 transition-colors hover:text-accent hover:decoration-accent/40"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
