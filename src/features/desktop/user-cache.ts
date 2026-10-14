/**
 * Desktop app (ADR-010): the last signed-in user, so the app can open offline.
 *
 * Signing in builds the user from the database (profile and role). Offline that read fails, and
 * once the access token has expired Supabase cannot refresh it either -- it keeps the session on
 * disk (a network failure is "retryable") but reports none. Without this cache a teacher opening
 * the app offline would be sent to the login page, or shown as a student. The cache holds the
 * public facts of the account only (id, name, e-mail, role, avatar); the session itself stays in
 * Supabase's own storage. Signing out removes it.
 */

import type { AuthUser } from "@/types/auth";

const KEY = "gestion-ecole.user";

export function readCachedUser(userId?: string): AuthUser | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as AuthUser;
    if (userId && user.id !== userId) return null;
    return user;
  } catch {
    return null;
  }
}

export function writeCachedUser(user: AuthUser): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(user));
  } catch {
    // Storage unavailable: the app still works online.
  }
}

export function clearCachedUser(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
