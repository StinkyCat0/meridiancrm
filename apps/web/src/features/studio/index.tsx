import { Globe2 } from "lucide-react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { PageHeader } from "../../components/ui/PageHeader";
import { Tabs, type TabItem } from "../../components/ui/Tabs";
import { STUDIO_WEBSITE_ORIGIN } from "./shared";

const TAB_ITEMS: readonly TabItem[] = [
  { value: "overview", label: "Overview" },
  { value: "accounts", label: "Accounts" },
  { value: "inquiries", label: "Inquiries" },
  { value: "chat", label: "Chat" },
  { value: "billing", label: "Billing" },
  { value: "demos", label: "Demos" },
  { value: "settings", label: "Settings" },
];

function activeTab(pathname: string): string {
  const segment = pathname.replace(/^\/app\/studio\/?/, "").split("/")[0] ?? "";
  return TAB_ITEMS.some((item) => item.value === segment)
    ? segment
    : "overview";
}

export default function StudioPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const active = activeTab(location.pathname);

  function selectTab(value: string) {
    navigate(value === "overview" ? "/app/studio" : `/app/studio/${value}`);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Studio"
        title="Website Studio"
        description="The public meridianstudios.org surface: accounts, inquiries, live chat, subscriptions and demo traffic."
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              window.open(STUDIO_WEBSITE_ORIGIN, "_blank", "noreferrer")
            }
          >
            <Globe2 className="size-4" aria-hidden="true" />
            Open website
          </Button>
        }
      />

      <Tabs
        items={TAB_ITEMS}
        value={active}
        onChange={selectTab}
        ariaLabel="Studio sections"
      />

      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
