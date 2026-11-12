import { BookOpen } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../../lib/auth";

const STORAGE_KEY = "meridian.walkthrough.toast.v1";
const TOAST_ID = "product-walkthrough";

function seenKey(userId: string, workspaceId: string | undefined): string {
  return `${STORAGE_KEY}:${workspaceId ?? "workspace"}:${userId}`;
}

/**
 * Shows the walkthrough invitation once per user and workspace. The user menu
 * and command palette remain the permanent entry points, so dismissing this
 * never removes access to the guide.
 */
export function WalkthroughToast() {
  const { user, workspace } = useAuth();
  const navigate = useNavigate();
  const shown = useRef(false);
  const userId = user?.id;
  const workspaceId = workspace?.id;

  useEffect(() => {
    if (!userId) return;

    const key = seenKey(userId, workspaceId);
    const markSeen = () => {
      try {
        window.localStorage.setItem(key, "1");
      } catch {
        // Storage can be unavailable in private or restricted contexts.
      }
    };

    try {
      if (window.localStorage.getItem(key) === "1") return;
    } catch {
      // Fall through and show the invitation when storage is unavailable.
    }

    if (shown.current) return;

    // Defer past StrictMode's mount/cleanup pass so the toast is created once.
    const timer = window.setTimeout(() => {
      shown.current = true;
      toast("Take the product walkthrough", {
        id: TOAST_ID,
        description:
          "Seven screens from the first visit to the collected payment.",
        duration: 20_000,
        closeButton: true,
        icon: <BookOpen className="size-4" aria-hidden="true" />,
        action: {
          label: "Start tour",
          onClick: () => {
            markSeen();
            navigate("/app/walkthrough");
          },
        },
        cancel: { label: "Not now", onClick: markSeen },
        onDismiss: markSeen,
        onAutoClose: markSeen,
      });
    }, 350);

    return () => {
      window.clearTimeout(timer);
      toast.dismiss(TOAST_ID);
    };
  }, [navigate, userId, workspaceId]);

  return null;
}
