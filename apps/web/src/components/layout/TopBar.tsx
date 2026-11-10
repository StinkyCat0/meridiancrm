import { ChevronRight, Search } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { openCommandPalette } from "../command/events";
import { sectionLabel } from "./nav";
import { UserMenu } from "./UserMenu";

export function TopBar() {
  const { workspace } = useAuth();
  const { pathname } = useLocation();

  return (
    <header className="sticky top-0 z-20 hidden border-b border-border bg-bg/70 backdrop-blur-xl lg:block">
      <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between gap-6 px-10">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="truncate text-muted">{workspace?.name ?? "Workspace"}</span>
          <ChevronRight className="size-3.5 shrink-0 text-muted/40" aria-hidden="true" />
          <span className="truncate font-medium text-fg">{sectionLabel(pathname)}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCommandPalette}
            aria-keyshortcuts="Meta+K Control+K"
            className="group flex h-9 w-64 items-center gap-2 rounded-input border border-border bg-surface-2 px-3 text-xs text-muted transition-colors hover:border-white/15 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Search className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Search anything…</span>
            <kbd className="num ml-auto rounded border border-border bg-bg/60 px-1.5 py-0.5 text-[10px] text-muted">
              ⌘K
            </kbd>
          </button>
          <UserMenu compact placement="down" />
        </div>
      </div>
    </header>
  );
}
