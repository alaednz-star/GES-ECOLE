import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  GraduationCap,
  Loader2,
  Pencil,
  School,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ErrorState } from "@/components/common/error-state";
import { ChoiceCard } from "@/features/onboarding/components/choice-card";
import { useLevels } from "@/features/school/queries";
import { streamName, useStreamOptions } from "@/features/school/streams";
import { useCompleteOnboarding } from "@/features/onboarding/queries";
import {
  createAcademicSchema,
  createGuardianSchema,
  createPersonalSchema,
  type AcademicValues,
  type GuardianValues,
  type PersonalValues,
} from "@/features/onboarding/schemas";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import type { LevelStage } from "@/features/school/types";
import { formatDate, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

const STAGES: LevelStage[] = ["primary", "middle", "high"];

const STAGE_LABEL_KEYS: Record<LevelStage, string> = {
  primary: "entity.levels.stagePrimary",
  middle: "entity.levels.stageMiddle",
  high: "entity.levels.stageHigh",
};

const STAGE_ICONS: Record<LevelStage, typeof School> = {
  primary: School,
  middle: BookOpen,
  high: GraduationCap,
};

/**
 * `stream` is conditional -- it only exists for levels that offer one. Keeping
 * it in the list and filtering it out (rather than renumbering) means every
 * other step keeps a stable identity regardless of the student's level.
 */
type StepId = "welcome" | "personal" | "guardian" | "academic" | "stream" | "review";

export function OnboardingWizard() {
  const { t, locale } = useI18n();
  const { user, refresh } = useAuth();
  const { notifyError } = useActionFeedback();
  const navigate = useNavigate();

  const [stepId, setStepId] = useState<StepId>("welcome");
  const [personal, setPersonal] = useState<PersonalValues | null>(null);
  const [guardian, setGuardian] = useState<GuardianValues | null>(null);

  const levelsQuery = useLevels();
  const streamOptions = useStreamOptions();
  const complete = useCompleteOnboarding(user?.id);

  const personalForm = useForm<PersonalValues>({
    resolver: zodResolver(createPersonalSchema(t)),
    defaultValues: {
      // Pre-fill the name captured at signup so the first field is already right.
      fullName: user?.fullName ?? "",
      gender: undefined as unknown as PersonalValues["gender"],
      dateOfBirth: "",
      phone: "",
    },
  });

  const guardianForm = useForm<GuardianValues>({
    resolver: zodResolver(createGuardianSchema(t)),
    defaultValues: { guardianName: "", guardianPhone: "", address: "" },
  });

  const academicForm = useForm<AcademicValues>({
    resolver: zodResolver(createAcademicSchema(t)),
    defaultValues: {
      stage: undefined as unknown as AcademicValues["stage"],
      levelId: "",
      streamId: null,
    },
  });

  const stage = academicForm.watch("stage");
  const levelId = academicForm.watch("levelId");
  const streamId = academicForm.watch("streamId");

  // Whether a stream is required comes from the data (Task 2A), never from a
  // hardcoded stage check -- primary and middle levels simply have no rows.
  const needsStream = streamOptions.levelHasStreams(levelId);
  const streamsForLevel = streamOptions.forLevel(levelId);

  const steps = useMemo(
    () =>
      [
        { id: "welcome", labelKey: "onboarding.step.welcome" },
        { id: "personal", labelKey: "onboarding.step.personal" },
        { id: "guardian", labelKey: "onboarding.step.guardian" },
        { id: "academic", labelKey: "onboarding.step.academic" },
        ...(needsStream ? [{ id: "stream", labelKey: "onboarding.step.stream" }] : []),
        { id: "review", labelKey: "onboarding.step.review" },
      ] as { id: StepId; labelKey: string }[],
    [needsStream],
  );

  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === stepId),
  );

  const yearsForStage = useMemo(
    () =>
      (levelsQuery.data ?? [])
        .filter((l) => l.stage === stage && l.status === "active")
        .sort((a, b) => a.position - b.position),
    [levelsQuery.data, stage],
  );

  const selectedLevel = (levelsQuery.data ?? []).find((l) => l.id === levelId);
  const selectedStream = streamsForLevel.find((s) => s.id === streamId);

  // Move focus to the heading on every step change so screen-reader users hear
  // the new step, and keyboard focus never gets stranded on a vanished button.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [stepId]);

  const goTo = (next: StepId) => setStepId(next);

  const submitPersonal = personalForm.handleSubmit((values) => {
    setPersonal(values);
    goTo("guardian");
  });

  const submitGuardian = guardianForm.handleSubmit((values) => {
    setGuardian(values);
    goTo("academic");
  });

  const submitAcademic = academicForm.handleSubmit(() => {
    goTo(needsStream ? "stream" : "review");
  });

  const confirmStream = () => {
    if (!streamId) {
      academicForm.setError("streamId", { message: t("onboarding.error.stream") });
      return;
    }
    goTo("review");
  };

  const submitAll = () => {
    if (!personal || !guardian || !levelId || complete.isPending) return;
    complete.mutate(
      {
        ...personal,
        ...guardian,
        levelId,
        // A level without streams must store NULL -- never a stale id left over
        // from a previous selection.
        streamId: needsStream ? (streamId ?? null) : null,
      },
      {
        onSuccess: async () => {
          // Refresh the session so the onboarding gate sees the new state,
          // otherwise the redirect below bounces straight back here.
          await refresh();
          await navigate({ to: "/dashboard", replace: true });
        },
        onError: (e) => notifyError(e),
      },
    );
  };

  if (levelsQuery.error || streamOptions.error) {
    return (
      <ErrorState
        error={levelsQuery.error ?? streamOptions.error}
        onRetry={() => {
          void levelsQuery.refetch();
          void streamOptions.refetch();
        }}
        isRetrying={levelsQuery.isFetching || streamOptions.isFetching}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <WizardHeader steps={steps} currentIndex={currentIndex} headingRef={headingRef} />

      <div
        key={stepId}
        className="surface-card mt-5 animate-in fade-in slide-in-from-bottom-2 p-5 duration-300 sm:mt-6 sm:p-7"
      >
        {stepId === "welcome" && (
          <div className="space-y-6 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
              <Sparkles className="size-6" aria-hidden />
            </span>
            <div className="space-y-2">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t("onboarding.welcomeBody")}
              </p>
              <p className="text-xs text-muted-foreground">{t("onboarding.welcomeTime")}</p>
            </div>
            <Button
              type="button"
              className="h-12 w-full rounded-xl text-base"
              onClick={() => goTo("personal")}
            >
              {t("onboarding.start")}
              <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            </Button>
          </div>
        )}

        {stepId === "personal" && (
          <Form {...personalForm}>
            <form onSubmit={submitPersonal} className="space-y-5" noValidate>
              <FormField
                control={personalForm.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("onboarding.fullName")}</FormLabel>
                    <FormControl>
                      <Input autoComplete="name" className="h-12 rounded-xl" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={personalForm.control}
                name="gender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("onboarding.gender")}</FormLabel>
                    <FormControl>
                      <div className="grid grid-cols-2 gap-3">
                        {(["male", "female"] as const).map((g) => (
                          <ChoiceCard
                            key={g}
                            selected={field.value === g}
                            onSelect={() => field.onChange(g)}
                            label={t(
                              g === "male" ? "onboarding.genderMale" : "onboarding.genderFemale",
                            )}
                            icon={UserRound}
                          />
                        ))}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={personalForm.control}
                name="dateOfBirth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("onboarding.dateOfBirth")}</FormLabel>
                    <FormControl>
                      <Input type="date" className="h-12 rounded-xl" max={todayIso()} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={personalForm.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("onboarding.phone")}{" "}
                      <span className="font-normal text-muted-foreground">
                        {t("onboarding.optional")}
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        // Phone numbers stay left-to-right even in Arabic.
                        dir="ltr"
                        placeholder="0555 12 34 56"
                        className="h-12 rounded-xl"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <StepNav onBack={() => goTo("welcome")} nextLabel={t("onboarding.next")} />
            </form>
          </Form>
        )}

        {stepId === "guardian" && (
          <Form {...guardianForm}>
            <form onSubmit={submitGuardian} className="space-y-5" noValidate>
              <p className="rounded-xl bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                {t("onboarding.guardianWhy")}
              </p>

              <FormField
                control={guardianForm.control}
                name="guardianName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("onboarding.guardianName")}</FormLabel>
                    <FormControl>
                      <Input className="h-12 rounded-xl" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={guardianForm.control}
                name="guardianPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("onboarding.guardianPhone")}</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        inputMode="tel"
                        dir="ltr"
                        placeholder="0661 78 90 12"
                        className="h-12 rounded-xl"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={guardianForm.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("onboarding.address")}{" "}
                      <span className="font-normal text-muted-foreground">
                        {t("onboarding.optional")}
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        className="min-h-20 rounded-xl"
                        placeholder={t("onboarding.addressPlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <StepNav onBack={() => goTo("personal")} nextLabel={t("onboarding.next")} />
            </form>
          </Form>
        )}

        {stepId === "academic" && (
          <Form {...academicForm}>
            <form onSubmit={submitAcademic} className="space-y-6" noValidate>
              <FormField
                control={academicForm.control}
                name="stage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("onboarding.cycle")}</FormLabel>
                    <FormControl>
                      <div className="grid gap-3">
                        {STAGES.map((s) => (
                          <ChoiceCard
                            key={s}
                            selected={field.value === s}
                            onSelect={() => {
                              field.onChange(s);
                              // The chosen year and stream belong to the previous
                              // cycle; clear both so no mismatched pair survives.
                              academicForm.setValue("levelId", "", { shouldValidate: false });
                              academicForm.setValue("streamId", null, { shouldValidate: false });
                              academicForm.clearErrors(["levelId", "streamId"]);
                            }}
                            label={t(STAGE_LABEL_KEYS[s])}
                            icon={STAGE_ICONS[s]}
                          />
                        ))}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Years appear only after a cycle exists -- never an empty list. */}
              {stage && (
                <FormField
                  control={academicForm.control}
                  name="levelId"
                  render={({ field }) => (
                    <FormItem className="animate-in fade-in slide-in-from-bottom-1 duration-200">
                      <FormLabel>{t("onboarding.year")}</FormLabel>
                      <FormControl>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {yearsForStage.map((l) => (
                            <ChoiceCard
                              key={l.id}
                              selected={field.value === l.id}
                              onSelect={() => {
                                field.onChange(l.id);
                                // A stream belongs to one specific year.
                                academicForm.setValue("streamId", null, { shouldValidate: false });
                                academicForm.clearErrors("streamId");
                              }}
                              label={l.name}
                              className="min-h-14"
                            />
                          ))}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <StepNav
                onBack={() => goTo("guardian")}
                nextLabel={needsStream ? t("onboarding.next") : t("onboarding.review")}
              />
            </form>
          </Form>
        )}

        {stepId === "stream" && (
          <div className="space-y-6">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {t("onboarding.streamHint", { year: selectedLevel?.name ?? "" })}
              </p>
            </div>

            <div className="grid gap-2">
              {streamsForLevel.map((s) => (
                <ChoiceCard
                  key={s.id}
                  selected={streamId === s.id}
                  onSelect={() => {
                    academicForm.setValue("streamId", s.id, { shouldValidate: false });
                    academicForm.clearErrors("streamId");
                  }}
                  label={streamName(s, locale)}
                />
              ))}
            </div>

            {academicForm.formState.errors.streamId && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {academicForm.formState.errors.streamId.message}
              </p>
            )}

            <StepNav
              onBack={() => goTo("academic")}
              onNext={confirmStream}
              nextLabel={t("onboarding.review")}
            />
          </div>
        )}

        {stepId === "review" && personal && guardian && (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">{t("onboarding.reviewBody")}</p>

            <ReviewSection
              title={t("onboarding.step.personal")}
              onEdit={() => goTo("personal")}
              rows={[
                [t("onboarding.fullName"), personal.fullName],
                [
                  t("onboarding.gender"),
                  t(
                    personal.gender === "male"
                      ? "onboarding.genderMale"
                      : "onboarding.genderFemale",
                  ),
                ],
                [t("onboarding.dateOfBirth"), formatDate(personal.dateOfBirth, locale)],
                [t("onboarding.phone"), personal.phone || t("onboarding.notProvided")],
              ]}
            />

            <ReviewSection
              title={t("onboarding.step.guardian")}
              onEdit={() => goTo("guardian")}
              rows={[
                [t("onboarding.guardianName"), guardian.guardianName],
                [t("onboarding.guardianPhone"), guardian.guardianPhone],
                ...(guardian.address
                  ? [[t("onboarding.address"), guardian.address] as [string, string]]
                  : []),
              ]}
            />

            <ReviewSection
              title={t("onboarding.step.academic")}
              onEdit={() => goTo("academic")}
              highlight
              rows={[
                [t("onboarding.year"), selectedLevel?.name ?? "—"],
                ...(needsStream
                  ? ([
                      [
                        t("onboarding.stream"),
                        selectedStream ? streamName(selectedStream, locale) : "—",
                      ],
                    ] as [string, string][])
                  : []),
              ]}
            />

            <p className="rounded-xl bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              {t("onboarding.reviewNote")}
            </p>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                className="h-12 rounded-xl"
                onClick={() => goTo(needsStream ? "stream" : "academic")}
                disabled={complete.isPending}
              >
                <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
                {t("onboarding.back")}
              </Button>
              <Button
                type="button"
                className="h-12 flex-1 rounded-xl text-base sm:flex-none sm:px-8"
                onClick={submitAll}
                disabled={complete.isPending}
              >
                {complete.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-4" aria-hidden />
                )}
                {complete.isPending ? t("onboarding.submitting") : t("onboarding.submit")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Back / continue pair. `onNext` omitted means the form's own submit runs. */
function StepNav({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack: () => void;
  onNext?: (() => void) | undefined;
  nextLabel: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-between">
      <Button type="button" variant="ghost" className="h-12 rounded-xl" onClick={onBack}>
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("onboarding.back")}
      </Button>
      <Button
        type={onNext ? "button" : "submit"}
        className="h-12 flex-1 rounded-xl text-base sm:flex-none sm:px-8"
        {...(onNext ? { onClick: onNext } : {})}
      >
        {nextLabel}
        <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
      </Button>
    </div>
  );
}

function WizardHeader({
  steps,
  currentIndex,
  headingRef,
}: {
  steps: { id: StepId; labelKey: string }[];
  currentIndex: number;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const { t } = useI18n();
  const total = steps.length;
  const current = steps[currentIndex];

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight outline-none sm:text-2xl"
        >
          {current ? t(current.labelKey) : t("onboarding.title")}
        </h1>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {t("onboarding.stepCount", {
            current: String(currentIndex + 1),
            total: String(total),
          })}
        </span>
      </div>

      <Progress
        value={((currentIndex + 1) / total) * 100}
        className="h-1.5"
        aria-label={t("onboarding.progressAria", {
          current: String(currentIndex + 1),
          total: String(total),
        })}
      />

      {/* Dots stay compact on a phone where full labels would wrap badly. */}
      <ol className="flex items-center gap-1.5" aria-hidden>
        {steps.map((s, i) => (
          <li
            key={s.id}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < currentIndex ? "bg-success" : i === currentIndex ? "bg-primary" : "bg-border",
            )}
          />
        ))}
      </ol>
    </div>
  );
}

function ReviewSection({
  title,
  rows,
  onEdit,
  highlight,
}: {
  title: string;
  rows: [string, string][];
  onEdit: () => void;
  highlight?: boolean | undefined;
}) {
  const { t } = useI18n();
  return (
    <section
      className={cn(
        "rounded-2xl border p-4",
        highlight ? "border-primary/30 bg-primary-soft/40" : "border-border bg-muted/30",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-lg text-xs"
          onClick={onEdit}
        >
          <Pencil className="size-3" aria-hidden />
          {t("onboarding.edit")}
        </Button>
      </div>
      <dl className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate text-end font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
