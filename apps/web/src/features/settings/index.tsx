import { UserPlus } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { atLeast } from "@meridian/contracts";
import { Button } from "../../components/ui/Button";
import { PageHeader } from "../../components/ui/PageHeader";
import { Tabs, type TabItem } from "../../components/ui/Tabs";
import { useAuth } from "../../lib/auth";
import { AuditSection } from "./AuditSection";
import { PipelineSection } from "./PipelineSection";
import { ProfileSection } from "./ProfileSection";
import { TeamSection } from "./TeamSection";
import { WorkspaceSection } from "./WorkspaceSection";

const TAB_ITEMS: readonly TabItem[] = [
  { value: "profile", label: "Profile" },
  { value: "workspace", label: "Workspace" },
  { value: "team", label: "Team" },
  { value: "pipeline", label: "Pipeline" },
  { value: "audit", label: "Audit" },
];

export default function SettingsPage() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const canManage = role ? atLeast(role, "ADMIN") : false;
  const hash = location.hash.replace(/^#/, "");
  const active = TAB_ITEMS.some((item) => item.value === hash)
    ? hash
    : "profile";

  function selectTab(value: string) {
    navigate({ hash: value }, { replace: true });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description="Shape the workspace, manage access, and keep the pipeline honest."
        actions={
          <Button
            variant={canManage ? "primary" : "secondary"}
            onClick={() => selectTab("team")}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            {canManage ? "Invite teammate" : "View team"}
          </Button>
        }
      />

      <Tabs
        items={TAB_ITEMS}
        value={active}
        onChange={selectTab}
        ariaLabel="Settings sections"
      />

      <div className="min-w-0">
        {active === "profile" ? <ProfileSection /> : null}
        {active === "workspace" ? <WorkspaceSection /> : null}
        {active === "team" ? <TeamSection /> : null}
        {active === "pipeline" ? <PipelineSection /> : null}
        {active === "audit" ? <AuditSection /> : null}
      </div>
    </div>
  );
}
