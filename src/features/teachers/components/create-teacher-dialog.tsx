import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createTeacherFn } from "@/features/teachers/provisioning.functions";
import type { Credentials } from "@/features/teachers/components/credentials-dialog";
import { useSubjects } from "@/features/school/queries";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { isValidAlgerianPhone } from "@/lib/phone";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface Draft {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  subjectIds: string[];
  experienceYears: number;
  bio: string;
}

const emptyDraft = (): Draft => ({
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  subjectIds: [],
  experienceYears: 0,
  bio: "",
});

/**
 * Admin-only teacher provisioning.
 *
 * Everything privileged happens in the server function; this component only
 * validates input and renders the result. The temporary password arrives in the
 * response and is handed straight to the credentials dialog -- it is never
 * stored in component state beyond that hand-off.
 */
export function CreateTeacherDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (credentials: Credentials) => void;
}) {
  const { t } = useI18n();
  const { notifyError } = useActionFeedback();
  const { data: subjects = [] } = useSubjects();

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [pending, setPending] = useState(false);

  const patch = (values: Partial<Draft>) => setDraft((p) => ({ ...p, ...values }));

  const submit = async () => {
    if (pending) return;

    const fullName = `${draft.firstName.trim()} ${draft.lastName.trim()}`.trim();
    if (draft.firstName.trim().length < 2 || draft.lastName.trim().length < 2) {
      toast.error(t("teachers.create.nameRequired"));
      return;
    }
    if (!EMAIL_RE.test(draft.email.trim())) {
      toast.error(t("teachers.create.emailInvalid"));
      return;
    }
    if (draft.phone.trim() && !isValidAlgerianPhone(draft.phone)) {
      toast.error(t("onboarding.error.phoneInvalid"));
      return;
    }
    if (draft.subjectIds.length === 0) {
      toast.error(t("form.teachers.subjectRequired"));
      return;
    }

    setPending(true);
    try {
      // The server verifies this token independently; sending it does not grant
      // anything the caller does not already have.
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        toast.error(t("error.sessionExpired"));
        return;
      }

      const result = await createTeacherFn({
        data: {
          accessToken,
          fullName,
          email: draft.email.trim().toLowerCase(),
          phone: draft.phone.trim() || undefined,
          subjectIds: draft.subjectIds,
          experienceYears: draft.experienceYears,
          bio: draft.bio.trim() || undefined,
        },
      });

      if (!result.ok || !result.teacher) {
        toast.error(result.message ?? t("error.generic"));
        return;
      }

      onCreated({
        fullName: result.teacher.fullName,
        email: result.teacher.email,
        temporaryPassword: result.teacher.temporaryPassword,
      });
      setDraft(emptyDraft());
      onOpenChange(false);
    } catch (e) {
      notifyError(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) setDraft(emptyDraft());
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{t("teachers.create.title")}</DialogTitle>
        </DialogHeader>

        <p className="rounded-xl bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("teachers.create.intro")}
        </p>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nt-first">{t("teachers.create.firstName")}</Label>
              <Input
                id="nt-first"
                className="h-11 rounded-xl"
                value={draft.firstName}
                onChange={(e) => patch({ firstName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nt-last">{t("teachers.create.lastName")}</Label>
              <Input
                id="nt-last"
                className="h-11 rounded-xl"
                value={draft.lastName}
                onChange={(e) => patch({ lastName: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nt-email">{t("teachers.create.email")}</Label>
            <Input
              id="nt-email"
              type="email"
              dir="ltr"
              className="h-11 rounded-xl"
              value={draft.email}
              onChange={(e) => patch({ email: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t("teachers.create.emailHint")}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nt-phone">
                {t("teachers.create.phone")}{" "}
                <span className="font-normal text-muted-foreground">
                  {t("onboarding.optional")}
                </span>
              </Label>
              <Input
                id="nt-phone"
                type="tel"
                inputMode="tel"
                dir="ltr"
                placeholder="0661 78 90 12"
                className="h-11 rounded-xl"
                value={draft.phone}
                onChange={(e) => patch({ phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nt-exp">{t("form.teachers.experience")}</Label>
              <Input
                id="nt-exp"
                type="number"
                min={0}
                max={60}
                className="h-11 rounded-xl"
                value={draft.experienceYears}
                onChange={(e) => patch({ experienceYears: Number(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("form.teachers.subjects")}</Label>
            <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
              {subjects.map((s) => {
                const checked = draft.subjectIds.includes(s.id);
                return (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        patch({
                          subjectIds: value
                            ? [...draft.subjectIds, s.id]
                            : draft.subjectIds.filter((id) => id !== s.id),
                        })
                      }
                    />
                    <span className="truncate">{s.name}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t("teachers.create.subjectsHint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nt-bio">
              {t("teachers.create.notes")}{" "}
              <span className="font-normal text-muted-foreground">{t("onboarding.optional")}</span>
            </Label>
            <Textarea
              id="nt-bio"
              className="min-h-20 rounded-xl"
              maxLength={2000}
              value={draft.bio}
              onChange={(e) => patch({ bio: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t("entity.common.cancel")}
          </Button>
          <Button className="rounded-xl" onClick={submit} disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <UserPlus className="size-4" aria-hidden />
            )}
            {pending ? t("teachers.create.creating") : t("teachers.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
