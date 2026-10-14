/**
 * Deactivate, reactivate and delete, for one row of the users list.
 *
 * WHY THE ACTIONS ARE SHOWN EVEN WHEN THEY ARE REFUSED. An administrator who cannot find
 * "Deactivate" concludes the feature does not exist and goes looking for the database. One
 * who sees it greyed out, with "this is the last administrator who can sign in" beside it,
 * has learnt how the system protects them. The reason is always named.
 *
 * THIS IS NOT WHERE THE RULES ARE ENFORCED. `private.assert_admin_removable` is, and it
 * refuses a request that never went near this component. What is here decides what the screen
 * offers, from the same rules, so the menu and the database say the same thing.
 */

import { useState } from "react";
import { Loader2, MoreHorizontal, Power, PowerOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/hooks/use-i18n";
import {
  offeredActions,
  type AdminAction,
  type AdminActionBlock,
  type LifecycleContext,
  type LifecycleTarget,
} from "../admin-lifecycle-model";

export interface AdminLifecycleActionsProps {
  user: LifecycleTarget & { fullName: string; email: string };
  ctx: LifecycleContext;
  pending: boolean;
  onRun: (action: AdminAction) => void;
}

const ICONS: Record<AdminAction, typeof Power> = {
  deactivate: PowerOff,
  reactivate: Power,
  delete: Trash2,
};

export function AdminLifecycleActions({ user, ctx, pending, onRun }: AdminLifecycleActionsProps) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState<AdminAction | null>(null);

  const actions = offeredActions(user, ctx);
  if (actions.length === 0) return null;

  const reasonFor = (block: AdminActionBlock | null) =>
    block === "self"
      ? t("dash.users.blocked.self")
      : block === "lastAdmin"
        ? t("dash.users.blocked.lastAdmin")
        : undefined;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-10 rounded-xl p-0"
            disabled={pending}
            aria-label={t("dash.users.actionsFor", { name: user.fullName || user.email })}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <MoreHorizontal className="size-4" aria-hidden />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {actions.map(({ action, block }) => {
            const Icon = ICONS[action];
            return (
              <DropdownMenuItem
                key={action}
                disabled={block !== null}
                // `onSelect` and not `onClick`: a disabled item still receives a click in
                // Radix, and the confirmation would open for an action that cannot run.
                onSelect={() => block === null && setConfirming(action)}
                className={action === "delete" ? "text-destructive" : undefined}
              >
                <Icon className="size-4" aria-hidden />
                <span className="flex-1">{t(`dash.users.action.${action}`)}</span>
                {block !== null && (
                  <span className="text-xs text-muted-foreground">{reasonFor(block)}</span>
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {confirming && (
        <AlertDialog open onOpenChange={(next) => !next && setConfirming(null)}>
          <AlertDialogContent className="rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`dash.users.confirm.${confirming}.title`)}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(`dash.users.confirm.${confirming}.body`, {
                  name: user.fullName || user.email,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {/* What will happen, and what will not. Deactivation being reversible is the
                fact that decides which action an administrator picks, so it is stated. */}
            <ul className="space-y-2 rounded-xl bg-muted/50 px-4 py-3 text-sm">
              {(confirming === "deactivate"
                ? ["dash.users.effect.blocksLogin", "dash.users.effect.reversible"]
                : confirming === "reactivate"
                  ? ["dash.users.effect.restoresLogin"]
                  : ["dash.users.effect.permanent", "dash.users.effect.auditSurvives"]
              ).map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>

            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button variant="ghost" className="rounded-xl">
                  {t("entity.common.cancel")}
                </Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  className="rounded-xl"
                  variant={confirming === "delete" ? "destructive" : "default"}
                  onClick={() => {
                    const action = confirming;
                    setConfirming(null);
                    onRun(action);
                  }}
                >
                  {t(`dash.users.action.${confirming}`)}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
