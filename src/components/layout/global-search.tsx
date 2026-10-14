import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  ClipboardList,
  GraduationCap,
  Layers3,
  Search,
  Users,
  UserSquare2,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { navigableItems } from "@/config/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import {
  useGroups,
  useRegistrations,
  useLevels,
  useStudents,
  useSubjects,
  useTeachers,
} from "@/features/school/queries";

const MAX_PER_GROUP = 5;

export function GlobalSearch() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pages = useMemo(() => navigableItems(user?.role ?? null), [user?.role]);

  const go = (to: string) => {
    setOpen(false);
    void navigate({ to });
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-10 w-full max-w-xs justify-start gap-2 rounded-xl bg-background px-3 text-muted-foreground hover:text-foreground md:flex"
        aria-label={t("action.search")}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden truncate text-sm font-normal sm:inline">{t("search.hint")}</span>
        <kbd className="ms-auto hidden rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] md:inline">
          Ctrl K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={t("search.placeholder")} />
        <CommandList>
          <CommandEmpty>{t("search.empty")}</CommandEmpty>

          <CommandGroup heading={t("search.pages")}>
            {pages.map((page) => (
              <CommandItem
                key={page.to}
                value={`${t(page.labelKey)} ${page.to}`}
                onSelect={() => go(page.to)}
              >
                <page.icon className="size-4" aria-hidden />
                {t(page.labelKey)}
              </CommandItem>
            ))}
          </CommandGroup>

          {open && user?.role === "admin" && <EntityResults onSelect={go} />}
        </CommandList>
      </CommandDialog>
    </>
  );
}

function EntityResults({ onSelect }: { onSelect: (to: string) => void }) {
  const { t } = useI18n();
  const { data: students = [] } = useStudents();
  const { data: teachers = [] } = useTeachers();
  const { data: groups = [] } = useGroups();
  const { data: subjects = [] } = useSubjects();
  const { data: registrations = [] } = useRegistrations();
  const { data: levels = [] } = useLevels();

  return (
    <>
      {students.length > 0 && (
        <CommandGroup heading={t("search.students")}>
          {students.slice(0, MAX_PER_GROUP).map((s) => (
            <CommandItem
              key={s.id}
              value={`${s.fullName} ${s.email ?? ""} ${s.levelName ?? ""}`}
              onSelect={() => onSelect(`/dashboard/students/${s.id}`)}
            >
              <Users className="size-4" aria-hidden />
              <span className="truncate">{s.fullName}</span>
              <span className="ms-auto text-xs text-muted-foreground">{s.levelName ?? "—"}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {teachers.length > 0 && (
        <CommandGroup heading={t("search.teachers")}>
          {teachers.slice(0, MAX_PER_GROUP).map((tc) => (
            <CommandItem
              key={tc.id}
              value={`${tc.fullName} ${tc.subjects.join(" ")}`}
              onSelect={() => onSelect(`/dashboard/teachers/${tc.id}`)}
            >
              <UserSquare2 className="size-4" aria-hidden />
              <span className="truncate">{tc.fullName}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {groups.length > 0 && (
        <CommandGroup heading={t("search.groups")}>
          {groups.slice(0, MAX_PER_GROUP).map((g) => (
            <CommandItem
              key={g.id}
              value={`${g.name} ${g.subjectName ?? ""} ${g.teacherName ?? ""}`}
              onSelect={() => onSelect(`/dashboard/groups/${g.id}`)}
            >
              <GraduationCap className="size-4" aria-hidden />
              <span className="truncate">{g.name}</span>
              <span className="ms-auto text-xs text-muted-foreground">{g.subjectName ?? "—"}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {subjects.length > 0 && (
        <CommandGroup heading={t("search.subjects")}>
          {subjects.slice(0, MAX_PER_GROUP).map((s) => (
            <CommandItem key={s.id} value={s.name} onSelect={() => onSelect("/dashboard/subjects")}>
              <BookOpen className="size-4" aria-hidden />
              <span className="truncate">{s.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {levels.length > 0 && (
        <CommandGroup heading={t("search.levels")}>
          {levels.slice(0, MAX_PER_GROUP).map((l) => (
            <CommandItem key={l.id} value={l.name} onSelect={() => onSelect("/dashboard/levels")}>
              <Layers3 className="size-4" aria-hidden />
              <span className="truncate">{l.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {registrations.length > 0 && (
        <CommandGroup heading={t("search.registrations")}>
          {registrations.slice(0, MAX_PER_GROUP).map((r) => (
            <CommandItem
              key={r.id}
              value={`${r.studentName} ${r.groupName} ${r.status}`}
              onSelect={() => onSelect("/dashboard/registrations")}
            >
              <ClipboardList className="size-4" aria-hidden />
              <span className="truncate">{r.studentName}</span>
              <span className="ms-auto text-xs text-muted-foreground">{r.groupName}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </>
  );
}
