import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { Skeleton } from "../ui/Skeleton";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-3" role="status" aria-label="Loading workspace">
          <Skeleton className="mx-auto size-10 rounded-full" />
          <Skeleton className="mx-auto h-4 w-2/3" />
          <Skeleton className="mx-auto h-3 w-1/2" />
          <Skeleton className="mt-6 h-10 w-full" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <>{children}</>;
}
