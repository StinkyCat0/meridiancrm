import { Search, Settings } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { cn } from "../../lib/utils";
import { CommandPalette } from "../command/CommandPalette";
import { openCommandPalette } from "../command/events";
import { Avatar } from "../ui/Avatar";
import { IconButton } from "../ui/IconButton";
import { LogoLockup } from "./Logo";
import { MOBILE_NAV_ITEMS, NAV_ITEMS } from "./nav";
import { TopBar } from "./TopBar";
import { UserMenu } from "./UserMenu";

function SidebarLink({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  icon: (typeof NAV_ITEMS)[number]["icon"];
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-input px-3 py-2 text-sm transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          isActive
            ? "bg-white/[0.04] text-fg"
            : "text-muted hover:bg-white/[0.04] hover:text-fg",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden="true"
            className={cn(
              "absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full transition-colors",
              isActive ? "bg-accent" : "bg-transparent",
            )}
          />
          <Icon
            className={cn(
              "size-4 shrink-0 transition-colors",
              isActive ? "text-accent" : "text-muted group-hover:text-fg",
            )}
            aria-hidden="true"
          />
          {label}
        </>
      )}
    </NavLink>
  );
}

export function AppShell() {
  const { workspace, role } = useAuth();
  const workspaceName = workspace?.name ?? "Workspace";

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-border bg-bg/85 backdrop-blur-xl lg:flex">
        <div className="flex h-16 items-center px-5">
          <LogoLockup />
        </div>

        <div className="px-3">
          <div className="rounded-card border border-border bg-surface p-2.5">
            <div className="flex items-center gap-2.5">
              <Avatar name={workspaceName} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="label-micro">Workspace</p>
                <p className="truncate text-xs font-medium text-fg">{workspaceName}</p>
              </div>
              {role ? (
                <span className="rounded-full border border-border bg-white/5 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-muted">
                  {role}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <nav aria-label="Primary" className="mt-6 flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <SidebarLink
              key={item.to}
              to={item.to}
              label={item.label}
              icon={item.icon}
              end={item.end}
            />
          ))}
        </nav>

        <div className="space-y-1 border-t border-border p-3">
          <SidebarLink to="/app/settings" label="Settings" icon={Settings} />
          <UserMenu />
        </div>
      </aside>

      <div className="lg:pl-[248px]">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-bg/85 px-4 backdrop-blur-xl lg:hidden">
          <LogoLockup />
          <div className="flex items-center gap-1">
            <IconButton label="Search" size="sm" onClick={openCommandPalette}>
              <Search aria-hidden="true" />
            </IconButton>
            <UserMenu compact placement="down" />
          </div>
        </header>

        <TopBar />

        <main className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-10 lg:pt-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom tabs */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <div className="grid grid-cols-5">
          {MOBILE_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "relative flex flex-col items-center gap-1 py-2.5 text-[10px] transition-colors",
                  isActive ? "text-accent" : "text-muted hover:text-fg",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-6 top-0 h-px bg-accent"
                    />
                  ) : null}
                  <item.icon className="size-5" aria-hidden="true" />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      <CommandPalette />
    </div>
  );
}
