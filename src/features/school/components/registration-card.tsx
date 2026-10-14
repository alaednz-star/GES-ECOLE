/**
 * One registration, drawn by the shared `GroupCard`.
 *
 * This file used to be a second, parallel implementation of the catalogue card. It is now
 * an ADAPTER: it maps `MyRegistration` onto `GroupCardView` and supplies the two things
 * that legitimately differ on this surface -- the status badge, and the decision timeline
 * with its rejection note. Everything visual lives in `group-card.tsx`, so the catalogue
 * and "Mes inscriptions" cannot drift apart again.
 *
 * `actions` stays a slot rather than baked-in buttons because what a student can do depends
 * on status, and that decision belongs to the page: an approved registration offers the
 * timetable, a rejected one offers browsing again, a pending one can be withdrawn.
 *
 * `meta` is a slot for the same reason. The decision timeline is the right line for a page
 * about requests; on "Mes cours" the request is settled and old news, and what belongs
 * there is since when the student has been enrolled. Same card, different sentence.
 */

import type { ReactNode } from "react";
import { GroupCard, type GroupCardView } from "@/features/school/components/group-card";
import type { MyRegistration } from "@/features/school/my-registrations";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/format";

/** `MyRegistration` -> what the shared card needs. No pricing: money is not in the product. */
function viewOfRegistration(item: MyRegistration): GroupCardView {
  return {
    groupName: item.groupName,
    subjectName: item.subjectName,
    subjectKey: item.subjectKey,
    subjectColor: item.subjectColor,
    contextLabel: [item.levelName, item.streamName].filter(Boolean).join(" · ") || null,
    teacherName: item.teacherName,
    teacherAvatarUrl: item.teacherAvatarUrl,
    schedules: item.schedules,
    maxStudents: item.maxStudents,
    unavailable: item.groupUnavailable,
  };
}

export function RegistrationCard({
  item,
  meta,
  actions,
}: {
  item: MyRegistration;
  /** Overrides the decision timeline. Omit it on any page about requests. */
  meta?: ReactNode | undefined;
  actions?: ReactNode | undefined;
}) {
  const { t, locale } = useI18n();

  return (
    <GroupCard
      view={viewOfRegistration(item)}
      locale={locale}
      /*
        NO banner badge here, and no schedule pills.

        The status panel at the bottom already states pending / approved / rejected in a full
        sentence with its action attached, and the page's tab filter groups by status on top of
        that -- a chip in the banner was the third copy of the same fact. The pills were the
        second copy of the HORAIRE column. What is left is the one thing neither of those says:
        when the request was made and when it was answered.
      */
      meta={
        meta ?? (
          <p className="text-xs text-muted-foreground">
            {t("myReg.submittedOn", { date: formatDate(item.createdAt, locale) })}
            {item.decidedAt
              ? ` · ${t("myReg.decidedOn", { date: formatDate(item.decidedAt, locale) })}`
              : ""}
          </p>
        )
      }
      actions={actions}
    />
  );
}
