/**
 * ONE group card, for every surface that shows a group.
 *
 * There used to be two: `GroupCard` defined inside the catalogue route, and
 * `RegistrationCard` in this directory for "Mes inscriptions" and the confirmation page.
 * They rendered the same object with the same intent and had already drifted in banner
 * height, avatar size and spacing. Two implementations of one design is how a product
 * stops looking like one product, so this is the only one now and both pages adapt their
 * data into it rather than drawing their own.
 *
 * Three surfaces draw it now -- the catalogue, "Mes inscriptions" and "Mes cours" -- and
 * they differ only in what they put in the badge, meta and action slots. That is why the
 * page-level content is passed in rather than branched on here: a `variant` prop would be
 * the two implementations again, one file further down.
 *
 * It is PRESENTATIONAL. It takes a view model, a badge and an action area; it fetches
 * nothing, decides no state, and knows nothing about enrolment rules. `blockedBy`
 * precedence, withdrawal, approval and the one-per-subject rule all stay where they were.
 *
 * NO PRICING. Money is not part of the product yet, so there is no price badge, no
 * currency icon and no price row. `groups.price_dzd` is untouched -- the admin group
 * detail screen still shows it, and `MyRegistration.priceDzd` still feeds the recurrence
 * adapter in `student-portal.ts`.
 *
 * Vertical order, top to bottom, and the reason it is this order: the banner names the
 * subject by colour before a word is read; the teacher is who a student actually chooses;
 * the group name identifies it; the three blocks answer where/when/how much time; capacity
 * sizes the class; and the action area comes last because it is the consequence of
 * everything above it, not the headline.
 */

import type { ReactNode } from "react";
import { CalendarClock, DoorClosed, GraduationCap, Timer, Users } from "lucide-react";
import { PersonAvatar } from "@/features/profile/person-avatar";
import { weekdayLabel, weeklyHours } from "@/features/school/schedule";
import { subjectColor } from "@/features/school/session/subject-tint";
import type { ScheduleSlot } from "@/features/school/types";
import { useI18n } from "@/hooks/use-i18n";
import { formatDecimal } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The grid all three student course surfaces lay their cards out in.
 *
 * It lives beside the card rather than in each route because "the catalogue and Mes cours
 * look like one product" is a property of the pair, not of either page: when the gap was
 * 24px on one and 16px on the other, the same card read as two different sizes.
 *
 * `items-start` is the important part. Grid items stretch by default, so a row containing
 * one open card (two buttons) and one rejected card (a panel with the administration's
 * note) stretched the short one to the tall one's height and left ~110px of empty card
 * under its buttons -- measured, not guessed. Aligning to the start lets each card end
 * where its content ends; the row is still aligned, at the top, where the eye starts.
 */
export const CARD_GRID = "grid items-start gap-6 lg:grid-cols-2";

/** Everything the card draws. Both pages map their own row into this. */
export interface GroupCardView {
  groupName: string;
  subjectName: string | null;
  subjectKey: string | null;
  subjectColor: string | null;
  /** Level, plus stream when the group is restricted to one. Already joined for display. */
  contextLabel: string | null;
  teacherName: string | null;
  teacherAvatarUrl: string | null;
  schedules: ScheduleSlot[];
  maxStudents: number;
  /**
   * The group is no longer visible to this student -- RLS hides groups outside their
   * level, and an old registration can outlive that. The card then has no subject and no
   * schedule to show, so it says so instead of inventing a colour and three em dashes.
   */
  unavailable?: boolean | undefined;
}

export function GroupCard({
  view,
  locale,
  badge,
  meta,
  actions,
}: {
  view: GroupCardView;
  locale: string;
  /** Sits inside the banner. One or two short chips, never a paragraph. */
  badge?: ReactNode | undefined;
  /** State-specific detail between the capacity line and the action area. */
  meta?: ReactNode | undefined;
  /** The state/action area. Anchored to the bottom so cards in a row align. */
  actions?: ReactNode | undefined;
}) {
  const { t } = useI18n();
  const accent = subjectColor(view.subjectColor, view.subjectKey);
  const unavailable = view.unavailable === true;
  const room = view.schedules.find((s) => s.room)?.room ?? null;
  const hours = weeklyHours(view.schedules);
  const first = view.schedules[0];
  const hasTeacher = (view.teacherName ?? "").trim().length > 0;

  /*
    `line-clamp-2`, not `truncate`.

    A level like "3ème année secondaire · Sciences expérimentales" is information, and
    clipping it to "3ème année seco..." on the first line loses the stream entirely. Two
    lines is a controlled wrap with a hard ceiling, so a long name cannot push the card's
    height around either.
  */
  const identity = (
    <>
      <h3 className="line-clamp-2 text-lg font-semibold leading-snug tracking-tight">
        {unavailable ? t("myReg.unavailableGroup") : view.groupName}
      </h3>
      {unavailable ? (
        <p className="text-sm text-muted-foreground">{t("myReg.unavailableHint")}</p>
      ) : (
        <p className="mt-0.5 line-clamp-2 text-sm font-semibold" style={{ color: accent }}>
          {view.subjectName ?? "—"}
          {view.contextLabel ? (
            <span className="font-normal text-muted-foreground"> · {view.contextLabel}</span>
          ) : null}
        </p>
      )}
    </>
  );

  return (
    <article
      className={cn(
        // NO `h-full`, and the body below carries no `flex-1`.
        //
        // Both were here to give a row of cards one height. They did, by stretching the
        // shortest card in the row and leaving the slack inside it: an open card next to a
        // rejected one ended with 111px of blank card below its buttons. Height now comes
        // from content, and `CARD_GRID` aligns the row at the top instead.
        "surface-card overflow-hidden p-0",
        "transition-[transform,box-shadow,border-color] duration-150 ease-out",
        "hover:-translate-y-0.5 hover:border-border hover:shadow-[0_14px_32px_rgba(18,33,29,.12)]",
      )}
    >
      {/*
        BANNER. Down from 120px to 88px.

        At 120px it was the loudest thing on the card and the teacher and group -- the two
        things a student actually chooses between -- read as an afterthought below it. 88px
        is still a dominant colour field but it no longer wins the page. The gradient is
        built from the subject's own colour through color-mix, so it stays consistent with
        Ressources and Mes cours instead of becoming a second palette.
      */}
      <div
        className="relative h-20 shrink-0 overflow-hidden sm:h-[88px]"
        style={{
          background: unavailable
            ? "linear-gradient(120deg, var(--color-muted) 0%, var(--color-muted) 100%)"
            : `linear-gradient(120deg, ${accent} 0%, color-mix(in oklch, ${accent} 78%, white) 55%, color-mix(in oklch, ${accent} 62%, white) 100%)`,
        }}
      >
        {/* Decoration, large enough to read as texture rather than as an icon. `start-3`
            is logical, so it moves to the right-hand side under RTL. */}
        <GraduationCap
          aria-hidden
          className={cn(
            "pointer-events-none absolute -bottom-5 size-24 start-3",
            unavailable ? "text-foreground/10" : "text-white/20",
          )}
        />
        {badge ? (
          <div className="absolute top-3 flex flex-wrap items-center justify-end gap-1.5 end-3">
            {badge}
          </div>
        ) : null}
      </div>

      <div className="px-5 pb-5">
        {/*
          The teacher crosses the boundary. 72px with a card-coloured border and a soft
          shadow, pulled up by exactly half its height so it is centred on the seam.
        */}
        <div className="-mt-9 flex items-end gap-3">
          <PersonAvatar
            name={view.teacherName}
            url={view.teacherAvatarUrl}
            /*
              No subject tint when there is nobody there.

              `groups.teacher_id` is ON DELETE SET NULL, so a group really can outlive its
              teacher -- this is a state, not a rendering accident. Tinting the disc in the
              subject colour would dress the gap up as a person; left neutral, the "?" from
              `PersonAvatar`'s own initials fallback reads as the absence it is, next to a
              line that says so in words.
            */
            accent={unavailable || !hasTeacher ? undefined : accent}
            ring
            className="size-[72px] shrink-0 bg-card text-lg"
          />
          <div className="min-w-0 pb-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("dash.registration.teacher")}
            </p>
            <p
              className={cn(
                "truncate text-sm",
                hasTeacher ? "font-semibold" : "italic text-muted-foreground",
              )}
            >
              {hasTeacher ? view.teacherName : t("dash.registration.noTeacher")}
            </p>
          </div>
        </div>

        {/* Plain text. Opening the details used to be a click on the title, which was an
            invisible affordance; it is an explicit "Détails" button in the action area now,
            so the title does not also need to be a control. */}
        <div className="mt-3 min-w-0">{identity}</div>

        {!unavailable && (
          <>
            {/* Three equal metadata columns: where, when, how much time. */}
            {/* Two columns then three: at 375px a fixed three-up squeezes the labels to the
                point of clipping, so the third field wraps to its own row instead. */}
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Fact icon={DoorClosed} accent={accent} label={t("group.room")}>
                {room ?? "—"}
              </Fact>
              <Fact icon={CalendarClock} accent={accent} label={t("dash.registration.schedule")}>
                {first ? (
                  <>
                    {weekdayLabel(first.weekday, t).slice(0, 3)}{" "}
                    {/*
                      ONE isolate around the whole "14:00 +1" run, not one per part.

                      Both halves are direction-neutral, so two adjacent isolates let RTL
                      reorder them against each other -- it rendered "114:00+". Isolating the
                      pair keeps them together and in order as a single left-to-right run,
                      positioned as a unit inside the Arabic line.
                    */}
                    <span dir="ltr" style={{ unicodeBidi: "isolate" }} className="tabular-nums">
                      {first.startTime.slice(0, 5)}
                      {view.schedules.length > 1 ? (
                        <span className="font-medium text-muted-foreground">
                          {" "}
                          {t("dash.registration.moreSlots", {
                            count: view.schedules.length - 1,
                          })}
                        </span>
                      ) : null}
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </Fact>
              <Fact icon={Timer} accent={accent} label={t("dash.registration.weekly")}>
                {hours > 0
                  ? t("dash.registration.hoursPerWeek", { hours: formatDecimal(hours, locale) })
                  : "—"}
              </Fact>
            </dl>

            {/*
              CAPACITY, and capacity only.

              A student's `registrations` read is scoped to their own rows, so occupancy
              resolves to 0/N for them -- measured for nobody. The class SIZE is the honest
              version of the same fact and still says whether this is a class of 8 or 30.
              No ratio, no bar, no remaining-seats claim.
            */}
            <p className="mt-3 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Users className="size-3.5 shrink-0" style={{ color: accent }} aria-hidden />
              {t("dash.registration.groupSize", { count: view.maxStudents })}
            </p>
          </>
        )}

        {meta ? <div className="mt-3">{meta}</div> : null}

        {/*
          The action area follows the content immediately: no `mt-auto`, and now no stretched
          card above it either.

          `mt-auto` was tried first and opened a void in the middle of the card; keeping the
          stretch and letting the slack fall below the buttons only moved the hole to the
          bottom. Neither is a layout -- they are both ways of paying for equal heights with
          empty space. The card is sized by its content and the row aligns at the top, so
          this padding is the only gap left, and it is 16px on every state.
        */}
        {actions ? <footer className="pt-4">{actions}</footer> : null}
      </div>
    </article>
  );
}

/**
 * The state/action area, shared by both pages.
 *
 * Deliberately subordinate to the content above it: a tinted panel, not a headline. Both
 * the catalogue and "Mes inscriptions" compose their states from this, so "en attente"
 * looks the same on both surfaces while each page keeps its OWN state logic and its own
 * links -- the catalogue sends an approved student to Mes cours, the registrations list
 * sends them to the timetable. Only the content differs, never the treatment.
 */
export function StatePanel({
  tone,
  icon: Icon,
  title,
  value,
  hint,
  action,
}: {
  tone: "success" | "pending" | "rejected" | "blocked" | "neutral";
  icon?: typeof Users | undefined;
  title: string;
  /**
   * A fact this panel exists to state, rendered stronger than the hint below it.
   *
   * "Mes cours" needs it: the panel there is not a decision waiting to be made but the
   * next session, and the date is the point of the panel rather than a footnote to its
   * heading. It is a `ReactNode` because a time range has to be bidi-isolated as one run.
   */
  value?: ReactNode | undefined;
  hint?: string | undefined;
  action?: ReactNode | undefined;
}) {
  /*
    Amber means "waiting on someone", green "settled", red "refused", teal "informational",
    grey "unavailable". Pending was grey and read as inert; it is the one state where the
    student is waiting on a decision, so it gets the amber accent. `blocked` moves to teal
    because "you already hold this subject" is a fact to absorb, not a warning, and `full`
    moves to grey because a class being full is not an error.
  */
  const TONES = {
    success: "border-success/25 bg-success/5 text-success",
    pending: "border-accent/30 bg-accent/8 text-accent",
    rejected: "border-destructive/25 bg-destructive/5 text-destructive",
    blocked: "border-primary/25 bg-primary/5 text-primary",
    neutral: "border-border bg-muted/60 text-muted-foreground",
  } as const;
  const [border, bg, text] = TONES[tone].split(" ");

  /*
    One geometry for every state, so the five of them read as one family: same radius, same
    12px padding, icon at the start of the heading, value under it, hint under that, action
    last with 10px above it. `text-start` is explicit rather than inherited -- this panel is
    dropped into page footers, and one of them used to centre its text.
  */
  return (
    <div
      // A stable hook for the browser suites, like `data-person-avatar`: the five states are
      // supposed to be one family, and the only way to prove that is to measure all of them.
      data-state-panel=""
      className={cn("rounded-xl border p-3 text-start", border, bg)}
    >
      <p className={cn("flex items-center gap-1.5 text-sm font-semibold", text)}>
        {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
        <span className="min-w-0">{title}</span>
      </p>
      {value ? <p className="mt-1 text-[13px] font-semibold text-foreground">{value}</p> : null}
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-2.5">{action}</div> : null}
    </div>
  );
}

/**
 * One metadata column: compact tinted panel, small icon, small caps label, strong value.
 *
 * Tightened from `rounded-xl` and a loose two-line stack, which at three across read as
 * three large pills competing with the title. The label sets its own leading so the block
 * is the height of its two lines of text plus 8px of padding, and nothing more.
 */
export function Fact({
  icon: Icon,
  accent,
  label,
  children,
  className,
}: {
  icon: typeof Users;
  accent: string;
  label: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("min-w-0 rounded-lg bg-muted/60 px-2.5 py-2", className)}>
      <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase leading-none tracking-wider text-muted-foreground">
        <Icon className="size-3 shrink-0" style={{ color: accent }} aria-hidden />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-1.5 truncate text-[13px] font-semibold leading-none">{children}</dd>
    </div>
  );
}
