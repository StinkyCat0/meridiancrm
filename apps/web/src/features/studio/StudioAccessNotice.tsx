import { ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../lib/auth";

/**
 * Shown in place of the Studio surface when the signed-in member is below the
 * ADMIN role. The Studio proxies website admin data, so MEMBERs never load it.
 */
export default function StudioAccessNotice() {
  const { role } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Studio"
        title="Studio is for administrators"
        description="The website Studio surface is limited to workspace owners and admins."
      />

      <Card className="p-6">
        <div className="flex flex-col items-center text-center">
          <span
            className="flex size-11 items-center justify-center rounded-full border border-warning/30 bg-warning/10 text-warning"
            aria-hidden="true"
          >
            <ShieldAlert className="size-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-fg">
            Your workspace role does not include Studio access
          </p>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">
            You are signed in as{" "}
            <span className="font-medium text-fg">{role ?? "a member"}</span>.
            Ask a workspace owner or admin if you need to manage website
            accounts, inquiries or chat.
          </p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={() => navigate("/app")}
          >
            Back to overview
          </Button>
        </div>
      </Card>
    </div>
  );
}
