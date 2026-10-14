import { toast } from "sonner";
import { enrollmentProblem, subjectTakenGroup } from "@/features/school/registration-model";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

/**
 * Shows why the database refused an enrollment change (group full, already in the group,
 * subject already held elsewhere, closed enrollment), falling back to the shared error mapper
 * for anything else. One place, so every enrollment screen names a refusal the same way.
 */
export function useEnrollmentErrors() {
  const { t } = useI18n();
  const { notifyError } = useActionFeedback();
  /** `groupName`: the group being enrolled into, so "already there" is not reported as a clash. */
  return (e: unknown, groupName?: string | null) => {
    const key = enrollmentProblem(e, groupName);
    if (!key) return notifyError(e);
    toast.error(
      key === "enroll.error.subjectTaken" ? t(key, { group: subjectTakenGroup(e) ?? "—" }) : t(key),
    );
  };
}
