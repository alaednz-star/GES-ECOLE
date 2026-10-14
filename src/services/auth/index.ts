import { supabaseAuthService } from "./supabase-auth-service";
import type { AuthService } from "./auth-service";

/** Single composition point for the auth backend. */
export const authService: AuthService = supabaseAuthService;

export type { AuthService } from "./auth-service";
