import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authService } from "@/services/auth";
import { IS_DESKTOP } from "@/lib/desktop";
import type { AuthStatus, AuthUser, Credentials, RegisterPayload, Role } from "@/types/auth";

export interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  signIn: (credentials: Credentials) => Promise<AuthUser>;
  signUp: (payload: RegisterPayload) => Promise<AuthUser | null>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  hasRole: (role: Role) => boolean;
  hasAnyRole: (roles: Role[]) => boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const load = useCallback(async () => {
    const session = await authService.getSession();
    setUser(session?.user ?? null);
    setStatus(session ? "authenticated" : "unauthenticated");
  }, []);

  useEffect(() => {
    let active = true;
    void authService.getSession().then((session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setStatus(session ? "authenticated" : "unauthenticated");
    });
    const unsubscribe = authService.onAuthChange(() => {
      void load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [load]);

  const signIn = useCallback(async (credentials: Credentials) => {
    const session = await authService.signIn(credentials);
    setUser(session.user);
    setStatus("authenticated");
    return session.user;
  }, []);

  const signUp = useCallback(async (payload: RegisterPayload) => {
    const session = await authService.signUp(payload);
    if (session) {
      setUser(session.user);
      setStatus("authenticated");
      return session.user;
    }
    return null;
  }, []);

  const queryClient = useQueryClient();
  const signOut = useCallback(async () => {
    await authService.signOut();
    // Desktop app (ADR-010): the saved offline cache belongs to the person who signed out.
    if (IS_DESKTOP) {
      const { clearOfflineCache } = await import("@/features/desktop/offline");
      await clearOfflineCache(queryClient);
    }
    setUser(null);
    setStatus("unauthenticated");
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isAuthenticated: status === "authenticated" && !!user,
      signIn,
      signUp,
      signOut,
      refresh: load,
      hasRole: (role) => user?.role === role,
      hasAnyRole: (roles) => (user ? roles.includes(user.role) : false),
    }),
    [user, status, signIn, signUp, signOut, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
