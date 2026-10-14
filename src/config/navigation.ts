import {
  Award,
  BarChart3,
  BellRing,
  CalendarRange,
  ClipboardCheck,
  DoorOpen,
  FileBadge,
  Mail,
  MessagesSquare,
  Newspaper,
  NotebookPen,
  Percent,
  Tags,
  Receipt,
  TrendingUp,
  UserPlus,
  Wallet,
  Search,
  CalendarCheck,
  CalendarClock,
  BadgeDollarSign,
  BookOpen,
  ClipboardList,
  FileText,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  Layers3,
  Library,
  Contact,
  PieChart,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  UserRound,
  Users,
  UserSquare2,
} from "lucide-react";
import type { NavSection } from "@/types/common";
import type { Role } from "@/types/auth";

/** Central navigation registry — one source of truth for every menu. */
export const dashboardNavigation: NavSection[] = [
  {
    titleKey: "section.general",
    items: [
      // Same destination, role-specific label: a teacher's landing page IS their
      // day, so "Aujourd'hui" states its purpose where "Tableau de bord" only
      // named a control panel. Split by role rather than adding a label-override
      // field, so the registry stays declarative.
      {
        labelKey: "menu.overview",
        to: "/dashboard",
        icon: LayoutDashboard,
        exact: true,
        roles: ["admin", "student"],
      },
      {
        labelKey: "menu.today",
        to: "/dashboard",
        icon: CalendarClock,
        exact: true,
        roles: ["teacher"],
      },
    ],
  },
  {
    titleKey: "section.management",
    items: [
      { labelKey: "menu.students", to: "/dashboard/students", icon: Users, roles: ["admin"] },
      {
        labelKey: "menu.teachers",
        to: "/dashboard/teachers",
        icon: UserSquare2,
        roles: ["admin"],
      },
      { labelKey: "menu.hr", to: "/dashboard/hr", icon: Contact, roles: ["admin"] },
      { labelKey: "menu.subjects", to: "/dashboard/subjects", icon: BookOpen, roles: ["admin"] },
      { labelKey: "menu.levels", to: "/dashboard/levels", icon: Layers3, roles: ["admin"] },
      // Formation -> Group -> Enrollment (ADR-004): what is offered, how it is delivered, who is in.
      { labelKey: "menu.programs", to: "/dashboard/programs", icon: Library, roles: ["admin"] },
      { labelKey: "menu.groups", to: "/dashboard/groups", icon: GraduationCap, roles: ["admin"] },
      {
        labelKey: "menu.registrations",
        to: "/dashboard/registrations",
        icon: ClipboardList,
        roles: ["admin"],
      },
      // ROADMAP (not implemented). Disabled entries with the shared "Bientôt" badge; their
      // `to` is a unique key only -- no route exists and the sidebar never links them.
      // Timetables covers conflict
      // detection; Official documents covers attestations, certificates and student cards.
      // Pre-registrations from formations' public pages (ADR-004 section 7).
      {
        labelKey: "menu.admissions",
        to: "/dashboard/admissions",
        icon: UserPlus,
        roles: ["admin"],
      },
      {
        labelKey: "menu.timetables",
        to: "/dashboard/timetables",
        icon: CalendarRange,
        roles: ["admin"],
      },
      {
        labelKey: "menu.rooms",
        to: "/dashboard/rooms",
        icon: DoorOpen,
        roles: ["admin"],
      },
      {
        labelKey: "menu.officialDocuments",
        to: "/dashboard/official-documents",
        icon: FileBadge,
        roles: ["admin"],
      },
      {
        labelKey: "menu.statistics",
        to: "/dashboard/statistics",
        icon: BarChart3,
        roles: ["admin"],
      },
    ],
  },
  {
    // Teaching itself: what happens in and around a session. Every entry is live for
    // administrators and teachers (a teacher works on the groups they teach; RLS enforces it).
    // Lesson log, assessments, grades and progression: ADR-008.
    titleKey: "section.pedagogy",
    items: [
      {
        labelKey: "menu.attendance",
        to: "/dashboard/attendance",
        icon: CalendarCheck,
        roles: ["admin", "teacher"],
      },
      {
        labelKey: "menu.attendanceReport",
        to: "/dashboard/attendance-report",
        icon: PieChart,
        roles: ["admin", "teacher"],
      },
      {
        labelKey: "menu.resources",
        to: "/dashboard/resources",
        icon: FolderOpen,
        roles: ["admin", "teacher"],
      },
      {
        labelKey: "menu.lessonLog",
        to: "/dashboard/lesson-log",
        icon: NotebookPen,
        roles: ["admin", "teacher"],
      },
      {
        labelKey: "menu.assessments",
        to: "/dashboard/assessments",
        icon: ClipboardCheck,
        roles: ["admin", "teacher"],
      },
      {
        labelKey: "menu.grades",
        to: "/dashboard/grades",
        icon: Award,
        roles: ["admin", "teacher"],
      },
      {
        labelKey: "menu.progression",
        to: "/dashboard/progression",
        icon: TrendingUp,
        roles: ["admin", "teacher"],
      },
    ],
  },
  {
    titleKey: "section.business",
    items: [
      {
        labelKey: "menu.payments",
        to: "/dashboard/payments",
        icon: BadgeDollarSign,
        roles: ["admin"],
      },
      {
        // The formations catalogue with prices (ADR-005): priced here, charged on enrollment.
        labelKey: "menu.pricing",
        to: "/dashboard/pricing",
        icon: Tags,
        roles: ["admin"],
      },
      {
        labelKey: "menu.invoices",
        to: "/dashboard/invoices",
        icon: FileText,
        roles: ["admin"],
      },
      {
        labelKey: "menu.receipts",
        to: "/dashboard/receipts",
        icon: Receipt,
        roles: ["admin"],
      },
      // No "Frais & échéanciers" entry: fees and installments exist (ADR-005) and are managed per
      // student, on the student page reached from « Élèves ». A roadmap badge would claim they do
      // not exist; a duplicate link to the students list would collide with « Élèves ». Fee
      // templates get an entry when they get a page.
      {
        labelKey: "menu.balances",
        to: "/dashboard/balances",
        icon: Wallet,
        roles: ["admin"],
      },
      {
        labelKey: "menu.discounts",
        to: "/dashboard/discounts",
        icon: Percent,
        roles: ["admin"],
      },
      {
        labelKey: "menu.reports",
        to: "/dashboard/reports",
        icon: PieChart,
        roles: ["admin"],
      },
    ],
  },
  {
    // Communication (ADR-009), SharePoint-style: the news site and conversations for every role;
    // the e-mail / SMS outbox and reminders for administrators.
    titleKey: "section.communication",
    items: [
      {
        labelKey: "menu.news",
        to: "/dashboard/news",
        icon: Newspaper,
        roles: ["admin", "teacher", "student"],
      },
      {
        labelKey: "menu.messaging",
        to: "/dashboard/messaging",
        icon: MessagesSquare,
        roles: ["admin", "teacher", "student"],
      },
      {
        labelKey: "menu.emailSms",
        to: "/dashboard/email-sms",
        icon: Mail,
        roles: ["admin"],
      },
      {
        labelKey: "menu.reminders",
        to: "/dashboard/reminders",
        icon: BellRing,
        roles: ["admin"],
      },
    ],
  },
  {
    titleKey: "section.space",
    items: [
      // Teacher area. `/dashboard/teacher` used to live here and rendered the
      // exact same component as `/dashboard` -- two menu entries, one screen.
      // The route now redirects; the workspace is reached from "Aujourd'hui".
      {
        labelKey: "menu.myGroups",
        to: "/dashboard/my-groups",
        icon: GraduationCap,
        roles: ["teacher"],
      },
      {
        labelKey: "menu.myStudents",
        to: "/dashboard/my-students",
        icon: Users,
        roles: ["teacher"],
      },
      // Student area. Each entry answers exactly one question; none overlap.
      {
        labelKey: "menu.myClasses",
        to: "/dashboard/my-classes",
        icon: GraduationCap,
        roles: ["student"],
      },
      {
        labelKey: "menu.myResources",
        to: "/dashboard/my-resources",
        icon: FolderOpen,
        roles: ["student"],
      },
      {
        labelKey: "menu.schedule",
        to: "/dashboard/schedule",
        icon: CalendarClock,
        roles: ["student"],
      },
      {
        labelKey: "menu.myAttendance",
        to: "/dashboard/my-attendance",
        icon: CalendarCheck,
        roles: ["student"],
      },
      {
        labelKey: "menu.registration",
        to: "/dashboard/registration",
        icon: Search,
        roles: ["student"],
      },
      {
        labelKey: "menu.myRegistrations",
        to: "/dashboard/my-registrations",
        icon: ClipboardList,
        roles: ["student"],
      },
    ],
  },
  {
    titleKey: "section.settings",
    items: [
      {
        labelKey: "menu.myProfile",
        to: "/dashboard/profile",
        icon: UserRound,
      },
      {
        labelKey: "menu.settings",
        to: "/dashboard/settings",
        icon: SlidersHorizontal,
        roles: ["admin"],
      },
      {
        labelKey: "menu.users",
        to: "/dashboard/users",
        icon: UserCog,
        roles: ["admin"],
      },
      {
        labelKey: "menu.security",
        to: "/dashboard/security",
        icon: ShieldCheck,
        roles: ["admin"],
        comingSoon: true,
      },
    ],
  },
];

export function filterNavigationByRole(sections: NavSection[], role: Role | null): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.roles || (role && item.roles.includes(role))),
    }))
    .filter((section) => section.items.length > 0);
}

/** Every navigable (implemented) destination — used by the global search palette. */
export function navigableItems(role: Role | null) {
  return filterNavigationByRole(dashboardNavigation, role)
    .flatMap((section) => section.items)
    .filter((item) => !item.comingSoon);
}
