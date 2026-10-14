/**
 * Which lifecycle actions an administrator may take on an account. PURE.
 *
 * No imports, so `node --test` can load it -- the same shape as `dependency-model.ts` and
 * `roster-model.ts`.
 *
 * THIS IS NOT THE ENFORCEMENT. `private.assert_admin_removable` is: it raises rather than
 * returning a boolean a caller could ignore, and it applies to every path in, including a
 * forged request that never went near this file. (It is not atomic either -- see the note in
 * that migration -- but it is the rule of record.) What lives here is the same rule
 * stated for the screen: which buttons appear, which are disabled, and the sentence that says
 * why. Written twice on purpose, in the two places it has to be true -- but written once
 * *here*, so the menu and the confirmation dialog cannot disagree with each other.
 *
 * If these ever drift, the database wins and the user sees a refusal after clicking. That is
 * the right way round: a UI that is too permissive is a bad message, while a database that is
 * too permissive is a school locked out of its own system.
 */

export type AdminAction = "deactivate" | "reactivate" | "delete";

/** Why an action is not offered. `null` means it is available. */
export type AdminActionBlock = "self" | "lastAdmin" | "notApplicable";

export interface LifecycleTarget {
  id: string;
  /** `admin` accounts are the ones that can lock everybody out. */
  role: string;
  /** False once the account is banned and can no longer sign in. */
  active: boolean;
}

export interface LifecycleContext {
  /** The signed-in administrator performing the action. */
  viewerId: string;
  /** Administrators who can sign in right now, including the target if they can. */
  activeAdminCount: number;
}

/**
 * Whether an action is possible, and if not, why.
 *
 * `notApplicable` is deliberately distinct from a refusal: deactivating an account that is
 * already deactivated is not forbidden, it is meaningless, and telling an administrator they
 * are "not allowed" to do a thing that has already happened is a confusing way to say so.
 */
export function blockReason(
  target: LifecycleTarget,
  action: AdminAction,
  ctx: LifecycleContext,
): AdminActionBlock | null {
  if (action === "reactivate") {
    // Only ever adds someone who can get in, so it needs no protection at all.
    return target.active ? "notApplicable" : null;
  }

  if (action === "deactivate" && !target.active) return "notApplicable";

  // Acting on your own row: the session ends underneath you, and the usual cause is a
  // mis-click in a list of names rather than an intention.
  if (target.id === ctx.viewerId) return "self";

  // Only an administrator who can currently sign in counts towards the lockout.
  //
  // This rarely fires on screen, and that is not an oversight. A viewer looking at this page
  // is a signed-in administrator, so they and the target are already two, and the case a
  // school actually hits -- deactivating the last one, themselves -- is caught by the self
  // rule above. It does fire in one real situation: a viewer whose own account was just
  // deactivated by somebody else and whose token has not yet expired. The database applies
  // the same rule regardless of who is asking, which is what protects the paths that are not
  // this page at all.
  const wouldRemoveAnActiveAdmin = target.role === "admin" && target.active;
  if (wouldRemoveAnActiveAdmin && ctx.activeAdminCount - 1 < 1) return "lastAdmin";

  return null;
}

/** True when the action may be attempted. */
export function isAllowed(
  target: LifecycleTarget,
  action: AdminAction,
  ctx: LifecycleContext,
): boolean {
  return blockReason(target, action, ctx) === null;
}

/**
 * The actions worth showing for a row, in the order they belong in a menu.
 *
 * Actions blocked by a rule are still listed -- disabled, with the reason -- because an
 * administrator who cannot find "Deactivate" concludes the feature is missing, while one who
 * sees it greyed out with "the last administrator" beside it has learnt how the system works.
 * Actions that are merely `notApplicable` are omitted: an account cannot be both.
 */
export function offeredActions(
  target: LifecycleTarget,
  ctx: LifecycleContext,
): { action: AdminAction; block: AdminActionBlock | null }[] {
  return (["deactivate", "reactivate", "delete"] as AdminAction[])
    .map((action) => ({ action, block: blockReason(target, action, ctx) }))
    .filter((a) => a.block !== "notApplicable");
}
