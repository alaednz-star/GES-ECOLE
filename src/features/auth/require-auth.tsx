import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { FullPageLoader } from "@/components/common/full-page-loader";
import type { Role } from "@/types/auth";

interface RequireAuthProps {
  children: ReactNode;
  /** When provided, the user must hold one of these roles. */
  roles?: Role[] | undefined;
  redirectTo?: string | undefined;
}

/**
 * Client-side access gate. Session hydration happens in the browser today;
 * once the backend lands this becomes a `beforeLoad` router guard without
 * changing any consumer.
 */
export function RequireAuth({ children, roles, redirectTo = "/login" }: RequireAuthProps) {
  const { status, isAuthenticated, hasAnyRole } = useAuth();

  if (status === "loading") return <FullPageLoader />;
  if (!isAuthenticated) return <Navigate to={redirectTo} replace />;
  if (roles && roles.length > 0 && !hasAnyRole(roles)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
