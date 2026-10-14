/**
 * The public page of a formation, reached by its link or QR code: what is offered, its groups,
 * and the pre-registration form (ADR-004 section 7). NO ACCOUNT: a parent or an adult learner
 * fills it on a phone; the administration reviews it on /dashboard/admissions.
 *
 * Everything shown comes from `getPublicFormationFn`, a minimal server-side projection (no
 * teacher, no student, no price). The form posts to `submitApplicationFn`, which validates again,
 * rate-limits and stores the request. Nothing here tells a visitor whether someone is already
 * known to the institution.
 */

import { useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { CalendarDays, CheckCircle2, Clock, Loader2, Users } from "lucide-react";
import { Brand } from "@/components/common/brand";
import { LanguageSwitcher } from "@/components/common/language-switcher";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  getPublicFormationFn,
  submitApplicationFn,
  type PublicFormation,
} from "@/features/admissions/admissions.functions";
import {
  GUARDIAN_RELATIONS,
  ageOn,
  emptyApplicationDraft,
  validateApplicationDraft,
  type ApplicationDraft,
  type ApplicationField,
} from "@/features/admissions/application-model";
import { weekdayLabel } from "@/features/school/schedule";
import { formatDate, todayIso } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";
import { useBrand } from "@/hooks/use-brand";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_GROUP = "__any__";
const NO_LEVEL = "__none__";

export const Route = createFileRoute("/preinscription/$programId")({
  loader: async ({ params }) => {
    if (!UUID.test(params.programId)) throw notFound();
    const formation = await getPublicFormationFn({ data: { programId: params.programId } });
    if (!formation) throw notFound();
    return formation;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData && loaderData.name
            ? `${loaderData.name} — Pré-inscription`
            : "Pré-inscription",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PreRegistrationPage,
  notFoundComponent: NotFoundFormation,
});

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-5 sm:px-6">
        <Brand />
        <LanguageSwitcher />
      </header>
      <main className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-16 sm:px-6">{children}</main>
    </div>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-border bg-card p-5 shadow-soft sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

function NotFoundFormation() {
  const { t } = useI18n();
  return (
    <Shell>
      <Panel>
        <h1 className="text-xl font-semibold">{t("admissions.public.notFoundTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("admissions.public.notFoundBody")}</p>
      </Panel>
    </Shell>
  );
}

function PreRegistrationPage() {
  const data = Route.useLoaderData();
  const { t } = useI18n();
  if (!data.open) {
    return (
      <Shell>
        <Panel>
          {data.name && <p className="text-sm text-muted-foreground">{data.name}</p>}
          <h1 className="mt-1 text-xl font-semibold" data-testid="public-closed">
            {t("admissions.public.closedTitle")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("admissions.public.closedBody")}</p>
        </Panel>
      </Shell>
    );
  }
  return <OpenFormation formation={data} />;
}

/** Before sending: the offer and the form. After: only the confirmation. */
function OpenFormation({ formation }: { formation: PublicFormation }) {
  const { t } = useI18n();
  const { brand } = useBrand();
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <Shell>
        <Panel className="text-center">
          <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
          <p className="mt-3 text-sm text-muted-foreground">{formation.name}</p>
          <h1 className="mt-1 text-xl font-semibold" data-testid="public-success">
            {t("admissions.public.successTitle")}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {t("admissions.public.successBody", { school: brand.schoolName ?? t("brand.name") })}
          </p>
        </Panel>
      </Shell>
    );
  }
  return (
    <Shell>
      <FormationSummary formation={formation} />
      <ApplicationForm formation={formation} onSent={() => setSent(true)} />
    </Shell>
  );
}

/**
 * When a group meets, in one line: its weekly slots ("Samedi 10:00–11:30"), or -- when the
 * institution has not set them yet -- its start date and a note that the times will be given.
 */
function useGroupWhen() {
  const { t, locale } = useI18n();
  return (g: PublicFormation["groups"][number]): string =>
    g.schedules.length > 0
      ? g.schedules
          .map(
            (s) =>
              `${weekdayLabel(s.weekday, t)} ${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`,
          )
          .join(" · ")
      : [
          t("admissions.public.startsOn", { date: formatDate(g.startDate, locale) }),
          t("admissions.public.scheduleTbc"),
        ].join(" · ");
}

function FormationSummary({ formation }: { formation: PublicFormation }) {
  const { t, locale } = useI18n();
  const groupWhen = useGroupWhen();
  const typeLabel = formation.type
    ? formation.type.builtIn
      ? t(`programs.category.${formation.type.code}`)
      : formation.type.name
    : null;
  const subject = formation.subject
    ? formation.subject.key &&
      t(`subject.${formation.subject.key}`) !== `subject.${formation.subject.key}`
      ? t(`subject.${formation.subject.key}`)
      : formation.subject.name
    : null;
  const facts = [typeLabel, subject, formation.levelName].filter(Boolean).join(" · ");

  return (
    <Panel>
      <p className="text-xs font-medium uppercase tracking-wide text-primary">
        {t("admissions.public.eyebrow")}
      </p>
      <h1
        className="mt-1 text-2xl font-semibold tracking-tight"
        data-testid="public-formation-name"
      >
        {formation.name}
      </h1>
      {facts && <p className="mt-1 text-sm text-muted-foreground">{facts}</p>}
      {formation.description && (
        <p className="mt-4 whitespace-pre-line text-sm leading-relaxed">{formation.description}</p>
      )}
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {(formation.startDate || formation.endDate) && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden />
            <span className="tabular-nums">
              {[formation.startDate, formation.endDate]
                .filter(Boolean)
                .map((d) => formatDate(d as string, locale))
                .join(" → ")}
            </span>
          </div>
        )}
        {formation.durationHours != null && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="size-4" aria-hidden />
            <span>{t("admissions.public.hours", { count: formation.durationHours })}</span>
          </div>
        )}
      </dl>

      {formation.groups.length > 0 && (
        <div className="mt-5 space-y-2">
          <h2 className="text-sm font-semibold">{t("admissions.public.groups")}</h2>
          <ul className="space-y-2">
            {formation.groups.map((g) => (
              <li key={g.id} className="rounded-xl border border-border px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{g.name}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="size-3.5" aria-hidden />
                    {g.placesLeft > 0
                      ? t("admissions.public.placesLeft", { count: g.placesLeft })
                      : t("admissions.public.full")}
                  </span>
                </div>
                <p
                  className="mt-1 text-xs text-muted-foreground"
                  dir="auto"
                  data-testid="group-when"
                >
                  {groupWhen(g)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  hint?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ApplicationForm({
  formation,
  onSent,
}: {
  formation: PublicFormation;
  onSent: () => void;
}) {
  const groupWhen = useGroupWhen();
  const { t, locale } = useI18n();
  const { brand } = useBrand();
  const [draft, setDraft] = useState<ApplicationDraft>(emptyApplicationDraft);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<ApplicationField, string>>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const [website, setWebsite] = useState("");
  const shownAt = useRef(Date.now());

  const set = <K extends keyof ApplicationDraft>(key: K, value: ApplicationDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const today = todayIso();
  const minor = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dateOfBirth)) return null;
    return ageOn(draft.dateOfBirth, today) < formation.guardianRequiredUnderAge;
  }, [draft.dateOfBirth, today, formation.guardianRequiredUnderAge]);
  // Until the birth date is known, both blocks are shown; then only what applies.
  const guardianShown = minor !== false;

  const validation = validateApplicationDraft(draft, {
    today,
    guardianRequiredUnderAge: formation.guardianRequiredUnderAge,
  });
  const errors = { ...(validation.ok ? {} : validation.errors), ...serverErrors };
  const show = (f: ApplicationField) => (submitted && errors[f] ? t(errors[f] as string) : null);

  const submit = async () => {
    setSubmitted(true);
    setFailure(null);
    setServerErrors({});
    if (!validation.ok) return;
    setStatus("sending");
    try {
      const result = await submitApplicationFn({
        data: {
          programId: formation.id,
          locale,
          website,
          elapsedMs: Date.now() - shownAt.current,
          draft,
        },
      });
      if (result.ok) {
        setStatus("sent");
        onSent();
        return;
      }
      setStatus("idle");
      if (result.code === "INVALID" && result.fields) setServerErrors(result.fields);
      else
        setFailure(
          t(
            `admissions.public.failure.${result.code === "RATE_LIMITED" || result.code === "CLOSED" ? result.code : "UNKNOWN"}`,
          ),
        );
    } catch {
      setStatus("idle");
      setFailure(t("admissions.public.failure.UNKNOWN"));
    }
  };

  return (
    <Panel>
      <h2 className="text-lg font-semibold">{t("admissions.public.formTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("admissions.public.formIntro")}</p>

      <form
        className="mt-5 space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {/* Honeypot: invisible to people, tempting to scripts. */}
        <div aria-hidden className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="app-website">Website</label>
          <input
            id="app-website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold">{t("admissions.public.learner")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="app-last-name"
              label={t("admissions.field.lastName")}
              error={show("lastName")}
            >
              <Input
                id="app-last-name"
                className="h-11 rounded-xl"
                autoComplete="family-name"
                value={draft.lastName}
                onChange={(e) => set("lastName", e.target.value)}
              />
            </Field>
            <Field
              id="app-first-name"
              label={t("admissions.field.firstName")}
              error={show("firstName")}
            >
              <Input
                id="app-first-name"
                className="h-11 rounded-xl"
                autoComplete="given-name"
                value={draft.firstName}
                onChange={(e) => set("firstName", e.target.value)}
              />
            </Field>
            <Field
              id="app-dob"
              label={t("admissions.field.dateOfBirth")}
              error={show("dateOfBirth")}
            >
              <Input
                id="app-dob"
                type="date"
                dir="ltr"
                className="h-11 rounded-xl"
                max={today}
                value={draft.dateOfBirth}
                onChange={(e) => set("dateOfBirth", e.target.value)}
              />
            </Field>
            <Field
              id="app-phone"
              label={t(minor ? "admissions.field.phoneOptional" : "admissions.field.phone")}
              error={show("phone")}
            >
              <Input
                id="app-phone"
                type="tel"
                dir="ltr"
                inputMode="tel"
                className="h-11 rounded-xl"
                autoComplete="tel"
                placeholder="0550 12 34 56"
                value={draft.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </Field>
            <Field id="app-email" label={t("admissions.field.email")} error={show("email")}>
              <Input
                id="app-email"
                type="email"
                dir="ltr"
                className="h-11 rounded-xl"
                autoComplete="email"
                value={draft.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </Field>
            <Field id="app-school-level" label={t("admissions.field.schoolLevel")}>
              <Select
                value={draft.schoolLevelId ?? NO_LEVEL}
                onValueChange={(v) => v && set("schoolLevelId", v === NO_LEVEL ? null : v)}
              >
                <SelectTrigger id="app-school-level" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LEVEL}>{t("admissions.field.notApplicable")}</SelectItem>
                  {formation.schoolLevels.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field
            id="app-school-name"
            label={t("admissions.field.schoolName")}
            error={show("schoolName")}
          >
            <Input
              id="app-school-name"
              className="h-11 rounded-xl"
              value={draft.schoolName}
              onChange={(e) => set("schoolName", e.target.value)}
            />
          </Field>
        </fieldset>

        {guardianShown && (
          <fieldset className="space-y-4" data-testid="guardian-block">
            <legend className="text-sm font-semibold">{t("admissions.public.guardian")}</legend>
            <p className="text-xs text-muted-foreground">
              {t("admissions.public.guardianHint", { age: formation.guardianRequiredUnderAge })}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="app-guardian-name"
                label={t("admissions.field.guardianName")}
                error={show("guardianName")}
              >
                <Input
                  id="app-guardian-name"
                  className="h-11 rounded-xl"
                  autoComplete="name"
                  value={draft.guardianName}
                  onChange={(e) => set("guardianName", e.target.value)}
                />
              </Field>
              <Field
                id="app-guardian-phone"
                label={t("admissions.field.guardianPhone")}
                error={show("guardianPhone")}
              >
                <Input
                  id="app-guardian-phone"
                  type="tel"
                  dir="ltr"
                  inputMode="tel"
                  className="h-11 rounded-xl"
                  placeholder="0550 12 34 56"
                  value={draft.guardianPhone}
                  onChange={(e) => set("guardianPhone", e.target.value)}
                />
              </Field>
              <Field
                id="app-guardian-relation"
                label={t("admissions.field.guardianRelation")}
                error={show("guardianRelation")}
              >
                <Select
                  value={draft.guardianRelation}
                  onValueChange={(v) =>
                    v && set("guardianRelation", v as ApplicationDraft["guardianRelation"])
                  }
                >
                  <SelectTrigger id="app-guardian-relation" className="h-11 rounded-xl">
                    <SelectValue placeholder={t("admissions.field.choose")} />
                  </SelectTrigger>
                  <SelectContent>
                    {GUARDIAN_RELATIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(`admissions.relation.${r}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </fieldset>
        )}

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold">{t("admissions.public.preferences")}</legend>
          {formation.groups.length > 0 && (
            <div className="space-y-2">
              <Label id="app-group-label">{t("admissions.field.preferredGroup")}</Label>
              <RadioGroup
                aria-labelledby="app-group-label"
                value={draft.preferredGroupId ?? NO_GROUP}
                onValueChange={(v) => set("preferredGroupId", v === NO_GROUP ? null : v)}
                className="space-y-1"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={NO_GROUP} id="app-group-any" />
                  {t("admissions.field.noPreference")}
                </label>
                {formation.groups.map((g) => (
                  <label key={g.id} className="flex items-start gap-2 text-sm">
                    <RadioGroupItem value={g.id} id={`app-group-${g.id}`} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block">{g.name}</span>
                      <span className="block text-xs text-muted-foreground" dir="auto">
                        {groupWhen(g)}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}
          <Field
            id="app-schedule"
            label={t("admissions.field.preferredSchedule")}
            error={show("preferredSchedule")}
          >
            <Input
              id="app-schedule"
              className="h-11 rounded-xl"
              value={draft.preferredSchedule}
              onChange={(e) => set("preferredSchedule", e.target.value)}
            />
          </Field>
          <Field id="app-message" label={t("admissions.field.message")} error={show("message")}>
            <Textarea
              id="app-message"
              rows={3}
              className="rounded-xl"
              value={draft.message}
              onChange={(e) => set("message", e.target.value)}
            />
          </Field>
        </fieldset>

        <div className="space-y-2">
          <label className="flex items-start gap-3 text-sm" htmlFor="app-consent">
            <Checkbox
              id="app-consent"
              checked={draft.consent}
              onCheckedChange={(v) => set("consent", v === true)}
              className="mt-0.5"
            />
            <span>
              {t("admissions.public.consent", { school: brand.schoolName ?? t("brand.name") })}
            </span>
          </label>
          {show("consent") && (
            <p className="text-xs text-destructive" role="alert">
              {show("consent")}
            </p>
          )}
        </div>

        {failure && (
          <p
            className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {failure}
          </p>
        )}
        {submitted && !validation.ok && (
          <p className="text-sm text-destructive" role="alert" data-testid="public-form-invalid">
            {t("admissions.public.fixErrors")}
          </p>
        )}

        <Button
          type="submit"
          className="h-11 w-full rounded-xl sm:w-auto"
          disabled={status === "sending"}
        >
          {status === "sending" && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("admissions.public.submit")}
        </Button>
      </form>
    </Panel>
  );
}
