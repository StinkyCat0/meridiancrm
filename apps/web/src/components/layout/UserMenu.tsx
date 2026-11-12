import { BookOpen, ChevronDown, LogOut, Settings, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../../lib/auth";
import { cn } from "../../lib/utils";
import { Avatar } from "../ui/Avatar";
import { Separator } from "../ui/Separator";

export interface UserMenuProps {
  compact?: boolean;
  placement?: "up" | "down";
}

const menuItemClasses =
  "flex w-full items-center gap-2.5 rounded-input px-2.5 py-2 text-left text-sm text-muted transition-colors hover:bg-white/5 hover:text-fg focus-visible:bg-white/5 focus-visible:text-fg focus-visible:outline-none";

export function UserMenu({ compact = false, placement = "up" }: UserMenuProps) {
  const { user, role, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;

    function handlePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
    } catch {
      toast.error(
        "The server session could not be closed. You have been signed out locally.",
      );
    } finally {
      setSigningOut(false);
      setOpen(false);
      navigate("/login", { replace: true });
    }
  }

  const name = user?.name ?? "Account";

  return (
    <div ref={rootRef} className={cn("relative", !compact && "w-full")}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "rounded-input transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          compact
            ? "flex items-center p-0.5"
            : "flex w-full items-center gap-2.5 p-2 text-left",
        )}
      >
        <Avatar name={name} src={user?.avatarUrl} size="sm" />
        {!compact ? (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-fg">
                {name}
              </span>
              <span className="block truncate text-[11px] text-muted">
                {user?.email}
              </span>
            </span>
            <ChevronDown className="size-3.5 text-muted" aria-hidden="true" />
          </>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className={cn(
            "absolute z-40 w-60 overflow-hidden rounded-card border border-border bg-surface p-1.5 shadow-panel",
            placement === "up"
              ? "bottom-full left-0 mb-2"
              : "right-0 top-full mt-2",
          )}
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium text-fg">{name}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
            {role ? <p className="label-micro mt-1.5">{role}</p> : null}
          </div>
          <Separator className="my-1" />
          <button
            type="button"
            role="menuitem"
            className={menuItemClasses}
            onClick={() => {
              setOpen(false);
              navigate("/app/walkthrough");
            }}
          >
            <BookOpen className="size-4" aria-hidden="true" />
            Walkthrough
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItemClasses}
            onClick={() => {
              setOpen(false);
              navigate("/app/settings?tab=profile");
            }}
          >
            <User className="size-4" aria-hidden="true" />
            Profile
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItemClasses}
            onClick={() => {
              setOpen(false);
              navigate("/app/settings");
            }}
          >
            <Settings className="size-4" aria-hidden="true" />
            Settings
          </button>
          <Separator className="my-1" />
          <button
            type="button"
            role="menuitem"
            className={cn(
              menuItemClasses,
              "text-danger hover:bg-danger/10 hover:text-danger",
            )}
            onClick={() => void handleSignOut()}
            disabled={signingOut}
          >
            <LogOut className="size-4" aria-hidden="true" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
