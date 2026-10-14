export type Gender = "male" | "female";

export interface OnboardingStatus {
  needsOnboarding: boolean;
  onboardedAt: string | null;
}

/** Everything the wizard collects, flattened across its three steps. */
export interface OnboardingInput {
  // Step 1 — personal
  fullName: string;
  gender: Gender;
  dateOfBirth: string;
  /** Optional. The guardian's number is the contact of record. */
  phone?: string | undefined;
  guardianName: string;
  guardianPhone: string;
  address?: string | undefined;
  // Academic
  levelId: string;
  /** Required when the level offers streams; NULL otherwise. Enforced in the DB. */
  streamId?: string | null | undefined;
}
