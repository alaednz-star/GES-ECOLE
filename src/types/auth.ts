/**
 * Authentication & authorization domain types.
 * Roles are the single source of truth for access control across the app.
 */

export const ROLES = ["admin", "teacher", "student"] as const;

export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  avatarUrl?: string | null;
  centerName?: string | null;
}

export interface AuthSession {
  user: AuthUser;
  expiresAt: number;
}

export interface Credentials {
  email: string;
  password: string;
}

/**
 * Public signup carries no role. The role is assigned by the database
 * (least privilege: `student`) and can only be changed by an admin through
 * `private.grant_role`. A client-supplied role would be authorisation input
 * originating in the browser -- see docs/ADR-001-identity-and-provisioning.md.
 */
export interface RegisterPayload extends Credentials {
  fullName: string;
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

/** Landing route for each role after sign-in. */
export const ROLE_HOME = {
  admin: "/dashboard",
  teacher: "/dashboard/teacher",
  // Merged: the student dashboard *is* /dashboard.
  student: "/dashboard",
} as const satisfies Record<Role, string>;
