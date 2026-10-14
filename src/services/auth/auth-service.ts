import type { AuthSession, Credentials, RegisterPayload } from "@/types/auth";

/**
 * Contract every auth backend must satisfy (Dependency Inversion).
 * The UI only ever depends on this interface, never on a concrete provider.
 */
export interface AuthService {
  getSession(): Promise<AuthSession | null>;
  signIn(credentials: Credentials): Promise<AuthSession>;
  signUp(payload: RegisterPayload): Promise<AuthSession | null>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  /** Subscribe to session changes. Returns an unsubscribe function. */
  onAuthChange(handler: () => void): () => void;
}
