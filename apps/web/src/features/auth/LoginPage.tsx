import { ApiError } from "@meridian/api-client";
import { Check, Copy } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { useAuth } from "../../lib/auth";
import { AuthLayout } from "./AuthLayout";
import { PasswordInput } from "./PasswordInput";

const DEMO_EMAIL = "demo@meridian.studio";
const DEMO_PASSWORD = "Meridian2026!";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  const state = location.state as { from?: unknown } | null;
  const from = typeof state?.from === "string" ? state.from : "/app";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Enter your email and password to continue.");
      return;
    }

    setPending(true);
    try {
      await login({ email: email.trim(), password });
      navigate(from, { replace: true });
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Sign-in failed. Check your connection and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  async function copyDemoCredentials() {
    try {
      await navigator.clipboard.writeText(`${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
      setCopied(true);
      toast.success("Demo credentials copied");
    } catch {
      toast.error("Copy failed. Select the credentials manually.");
    }
  }

  return (
    <AuthLayout>
      <div className="mb-8">
        <p className="label-micro">Welcome back</p>
        <h1 className="mt-2 text-3xl font-light tracking-tight text-fg">
          Sign in
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Continue to your workspace.
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        <Field label="Email" htmlFor="login-email">
          <Input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            invalid={Boolean(error)}
            required
          />
        </Field>

        <Field label="Password" htmlFor="login-password">
          <PasswordInput
            id="login-password"
            name="password"
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            invalid={Boolean(error)}
            required
          />
        </Field>

        {error ? (
          <p role="alert" className="text-sm leading-relaxed text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" fullWidth loading={pending}>
          Sign in
        </Button>
      </form>

      <button
        type="button"
        onClick={() => void copyDemoCredentials()}
        aria-label="Copy demo credentials"
        className="mt-5 flex w-full items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-white/15 hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="min-w-0">
          <span className="label-micro">Demo access</span>
          <span className="mt-1 block truncate text-xs font-medium text-fg">
            {DEMO_EMAIL}
          </span>
          <span className="block text-xs text-muted">{DEMO_PASSWORD}</span>
        </span>
        <span className="shrink-0 text-muted">
          {copied ? (
            <Check className="size-4 text-success" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
        </span>
      </button>

      <p className="mt-8 text-center text-sm text-muted">
        New to Meridian?{" "}
        <Link
          to="/register"
          className="font-medium text-fg underline decoration-border underline-offset-4 transition-colors hover:text-accent hover:decoration-accent/40"
        >
          Create a workspace
        </Link>
      </p>
    </AuthLayout>
  );
}
