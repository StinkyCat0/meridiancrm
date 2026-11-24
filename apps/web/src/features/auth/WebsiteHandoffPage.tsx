import { ApiError, api } from "@meridian/api-client";
import type { WebsiteHandoffPreview } from "@meridian/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Globe2, Link2Off } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Avatar } from "../../components/ui/Avatar";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { formatDateTime } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import { AuthLayout } from "./AuthLayout";

const WEBSITE_ORIGIN = (
  (import.meta.env.VITE_WEBSITE_URL as string | undefined) ??
  (import.meta.env.VITE_WEBSITE_PUBLIC_URL as string | undefined) ??
  ""
).replace(/\/+$/, "");
const WEBSITE_LOGIN_URL = `${WEBSITE_ORIGIN || "https://meridianstudios.org"}/login`;

function openWebsiteLogin() {
  window.location.assign(WEBSITE_LOGIN_URL);
}

function previewErrorCopy(error: unknown): {
  title: string;
  description: string;
} {
  if (error instanceof ApiError) {
    if (
      error.status === 400 ||
      error.status === 401 ||
      error.status === 403 ||
      error.status === 404
    ) {
      return {
        title: "This handoff link is no longer valid",
        description:
          "Handoff codes are single-use and expire after 60 seconds. Start again from the website to get a fresh link.",
      };
    }
    if (error.status === 410) {
      return {
        title: "This handoff link has already been used",
        description:
          "Each handoff code works once. Start again from the website to get a fresh link.",
      };
    }
    if (error.status === 503) {
      return {
        title: "Website handoff is not configured",
        description:
          "The CRM and website bridge is offline right now. Use your website login and try again later.",
      };
    }
    return {
      title: "Could not verify this handoff link",
      description: apiErrorMessage(error),
    };
  }
  return {
    title: "Could not verify this handoff link",
    description: apiErrorMessage(error),
  };
}

function previewStatusLabel(error: unknown): string {
  if (!(error instanceof ApiError)) return "Unavailable";
  if (
    error.status === 400 ||
    error.status === 401 ||
    error.status === 403 ||
    error.status === 404
  ) {
    return "Invalid or expired";
  }
  if (error.status === 410) return "Already used";
  if (error.status === 503) return "Not configured";
  return "Unavailable";
}

export default function WebsiteHandoffPage() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code")?.trim() ?? "";
  const navigate = useNavigate();
  const { acceptWebsiteHandoff } = useAuth();

  const previewQuery = useQuery({
    queryKey: queryKeys.auth.websiteHandoff(code),
    queryFn: () => api.auth.websiteHandoffPreview(code),
    enabled: code.length > 0,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const handoffMutation = useMutation({
    mutationFn: (handoffCode: string) => acceptWebsiteHandoff(handoffCode),
    onSuccess: () => {
      navigate("/app/studio", { replace: true });
    },
  });

  const preview: WebsiteHandoffPreview | undefined = previewQuery.data;

  // The code is single-use and short-lived; keep it out of the address bar,
  // browser history and subsequent referrers once this view has read it.
  useEffect(() => {
    if (!code) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("code")) return;
    params.delete("code");
    const search = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}`,
    );
  }, [code]);

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div>
          <p className="label-micro">Website handoff</p>
          <h1 className="mt-2 text-2xl font-light tracking-tight text-fg">
            Open your Studio workspace
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            A verified website account is signing into Meridian CRM. Review the
            account below before continuing.
          </p>
        </div>

        {!code ? (
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-full border border-warning/30 bg-warning/10 text-warning"
                aria-hidden="true"
              >
                <Link2Off className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">
                  No handoff code was provided
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  Open the CRM from your Meridian website account to receive a
                  fresh sign-in link.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2">
              <Button variant="primary" fullWidth onClick={openWebsiteLogin}>
                <Globe2 className="size-4" aria-hidden="true" />
                Go to website login
              </Button>
              <Button
                variant="ghost"
                fullWidth
                onClick={() => navigate("/login")}
              >
                Sign in with CRM credentials
              </Button>
            </div>
          </Card>
        ) : previewQuery.isPending ? (
          <Card
            className="p-5"
            role="status"
            aria-label="Verifying handoff link"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Skeleton className="mt-5 h-10 w-full" />
          </Card>
        ) : previewQuery.isError || !preview ? (
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger"
                aria-hidden="true"
              >
                <AlertTriangle className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-fg">
                    {previewErrorCopy(previewQuery.error).title}
                  </p>
                  <Badge tone="danger">
                    {previewStatusLabel(previewQuery.error)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {previewErrorCopy(previewQuery.error).description}
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2">
              <Button variant="primary" fullWidth onClick={openWebsiteLogin}>
                <Globe2 className="size-4" aria-hidden="true" />
                Go to website login
              </Button>
              <Button
                variant="ghost"
                fullWidth
                onClick={() => navigate("/login")}
              >
                Sign in with CRM credentials
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <Card className="p-5">
              <p className="label-micro">Website account</p>
              <div className="mt-3 flex items-center gap-3">
                <Avatar name={preview.name || preview.email} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">
                    {preview.name || "Website member"}
                  </p>
                  <p className="truncate text-xs text-muted">{preview.email}</p>
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4">
                <div>
                  <dt className="label-micro">Email verified</dt>
                  <dd className="mt-1.5">
                    <Badge tone={preview.isVerified ? "success" : "warning"}>
                      {preview.isVerified ? "Verified" : "Unverified"}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="label-micro">CRM access</dt>
                  <dd className="mt-1.5">
                    <Badge tone={preview.crmAccess ? "accent" : "warning"}>
                      {preview.crmAccess ? "Granted" : "Not granted"}
                    </Badge>
                  </dd>
                </div>
              </dl>

              <p className="mt-4 text-xs leading-relaxed text-muted">
                This link expires at{" "}
                <span className="num text-fg">
                  {formatDateTime(preview.expiresAt, "h:mm:ss a")}
                </span>
                . Continue only if this is your account.
              </p>
            </Card>

            {handoffMutation.isError ? (
              <div
                role="alert"
                className="rounded-card border border-danger/30 bg-danger/10 p-4"
              >
                <p className="text-sm font-medium text-danger">
                  Could not finish the handoff
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {handoffMutation.error instanceof ApiError &&
                  handoffMutation.error.status === 401
                    ? "The code may have expired or already been used, or no CRM account is linked to this email. Start again from the website, or ask a workspace owner to invite this email."
                    : apiErrorMessage(handoffMutation.error)}
                </p>
                <button
                  type="button"
                  className="mt-3 text-xs font-medium text-accent underline-offset-4 hover:underline"
                  onClick={openWebsiteLogin}
                >
                  Return to website login
                </button>
              </div>
            ) : null}

            <div className="space-y-2">
              <Button
                variant="primary"
                fullWidth
                loading={handoffMutation.isPending}
                onClick={() => {
                  if (code) handoffMutation.mutate(code);
                }}
              >
                Continue to Studio
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                fullWidth
                disabled={handoffMutation.isPending}
                onClick={() => navigate("/login")}
              >
                Cancel
              </Button>
            </div>

            <p className="text-center text-xs text-muted">
              Wrong account?{" "}
              <a
                href={WEBSITE_LOGIN_URL}
                className="font-medium text-accent underline-offset-4 hover:underline"
              >
                Sign in to the website
              </a>{" "}
              or use <Link to="/login">CRM sign in</Link>.
            </p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
