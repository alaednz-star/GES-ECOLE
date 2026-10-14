import type { Locale } from "./config";
import type { Dictionary } from "./types";
import { landing } from "./dicts/landing";
import { authPages } from "./dicts/authPages";
import { dashboard } from "./dicts/dashboard";
import { entities } from "./dicts/entities";
import { adminForms } from "./dicts/adminForms";
import { feedback } from "./dicts/feedback";
import { workspace } from "./dicts/workspace";
import { onboarding } from "./dicts/onboarding";
import { studentJourney } from "./dicts/studentJourney";
import { provisioning } from "./dicts/provisioning";
import { lifecycle } from "./dicts/lifecycle";
import { teacherWorkspace } from "./dicts/teacherWorkspace";
import { payments } from "./dicts/payments";
import { programs } from "./dicts/programs";
import { enrollment } from "./dicts/enrollment";
import { hr } from "./dicts/hr";
import { roster } from "./dicts/roster";
import { subjects } from "./dicts/subjects";
import { sessions } from "./dicts/sessions";
import { resources } from "./dicts/resources";
import { admissions } from "./dicts/admissions";
import { fees } from "./dicts/fees";
import { finance } from "./dicts/finance";
import { operations } from "./dicts/operations";
import { pedagogy } from "./dicts/pedagogy";
import { communication } from "./dicts/communication";
import { desktop } from "./dicts/desktop";

export type { Dictionary } from "./types";

const fr: Dictionary = {
  "brand.name": "Gestion École",
  "brand.tagline": "Gestion scolaire pour centres de soutien",

  "nav.features": "Fonctionnalités",
  "nav.pricing": "Tarifs",
  "nav.about": "À propos",
  "nav.login": "Connexion",
  "nav.register": "Créer un compte",
  "nav.dashboard": "Tableau de bord",

  "section.general": "Général",
  "section.management": "Gestion",
  "section.business": "Gestion financière",
  "section.settings": "Configuration",
  "section.space": "Mon espace",
  "section.pedagogy": "Pédagogie",
  "section.communication": "Communication",
  "menu.admissions": "Pré-inscriptions",
  "menu.timetables": "Emplois du temps",
  "menu.rooms": "Salles",
  "menu.officialDocuments": "Documents officiels",
  "menu.statistics": "Statistiques",
  "menu.lessonLog": "Cahier de textes",
  "menu.assessments": "Évaluations",
  "menu.grades": "Notes & bulletins",
  "menu.progression": "Progression",
  "menu.receipts": "Reçus",
  "menu.balances": "Soldes & impayés",
  "menu.discounts": "Remises & bourses",
  "menu.messaging": "Messagerie",
  "menu.emailSms": "E-mail & SMS",
  "menu.reminders": "Rappels & alertes",
  "section.account": "Compte",

  "menu.overview": "Tableau de bord",
  "menu.students": "Élèves",
  "menu.teachers": "Enseignants",
  "menu.subjects": "Matières",
  "menu.levels": "Niveaux",
  "menu.groups": "Groupes",
  "menu.programs": "Formations",
  "menu.hr": "Ressources humaines",
  "menu.registrations": "Inscriptions",
  "menu.attendance": "Présences",
  "menu.payments": "Paiements",
  "menu.pricing": "Formations & tarifs",
  "menu.invoices": "Factures",
  "menu.reports": "Rapports",
  "menu.settings": "Paramètres",
  "menu.users": "Utilisateurs",
  "menu.roles": "Rôles",
  "menu.security": "Sécurité",
  "menu.admin": "Administration",
  "menu.teacher": "Espace enseignant",
  "menu.student": "Espace élève",
  "menu.registration": "S'inscrire",
  "menu.support": "Assistance",

  "action.signIn": "Se connecter",
  "action.signOut": "Se déconnecter",
  "action.signUp": "S'inscrire",
  "action.getStarted": "Commencer",
  "action.back": "Retour",
  "action.backHome": "Retour à l'accueil",
  "action.search": "Rechercher",
  "action.toggleSidebar": "Afficher ou masquer le menu",
  "action.changeLanguage": "Changer de langue",

  "search.placeholder": "Rechercher un élève, un groupe, une page…",
  "search.hint": "Rechercher…",
  "search.empty": "Aucun résultat.",
  "search.pages": "Pages",
  "search.students": "Élèves",
  "search.teachers": "Enseignants",
  "search.groups": "Groupes",
  "search.subjects": "Matières",
  "search.registrations": "Inscriptions",

  "auth.welcome": "Bon retour",
  "auth.loginSubtitle": "Connectez-vous pour accéder à votre centre.",
  "auth.registerTitle": "Créer votre espace",
  "auth.registerSubtitle": "Quelques informations pour démarrer.",
  "auth.email": "Adresse e-mail",
  "auth.password": "Mot de passe",
  "auth.fullName": "Nom complet",
  "auth.role": "Rôle",
  "auth.haveAccount": "Vous avez déjà un compte ?",
  "auth.noAccount": "Pas encore de compte ?",
  "auth.demoNotice": "Vos données sont protégées et hébergées de façon sécurisée.",

  "role.admin": "Administrateur",
  "role.teacher": "Enseignant",
  "role.student": "Élève",

  "state.comingSoon": "Bientôt",
  "state.emptyTitle": "Rien à afficher pour l'instant",
  "state.emptyBody": "Aucune donnée à afficher pour le moment.",

  "notFound.title": "Page introuvable",
  "notFound.body": "Cette page n'existe pas ou a été déplacée.",
};

const ar: Dictionary = {
  "brand.name": "Gestion École",
  "brand.tagline": "إدارة مراكز الدعم المدرسي",

  "nav.features": "المميزات",
  "nav.pricing": "الأسعار",
  "nav.about": "من نحن",
  "nav.login": "تسجيل الدخول",
  "nav.register": "إنشاء حساب",
  "nav.dashboard": "لوحة التحكم",

  "section.general": "عام",
  "section.management": "الإدارة",
  "section.business": "الإدارة المالية",
  "section.settings": "الإعدادات",
  "section.space": "فضائي",
  "section.pedagogy": "البيداغوجيا",
  "section.communication": "التواصل",
  "menu.admissions": "التسجيلات المسبقة",
  "menu.timetables": "جداول التوقيت",
  "menu.rooms": "القاعات",
  "menu.officialDocuments": "الوثائق الرسمية",
  "menu.statistics": "الإحصائيات",
  "menu.lessonLog": "دفتر النصوص",
  "menu.assessments": "التقييمات",
  "menu.grades": "النقاط وكشوف النقاط",
  "menu.progression": "التدرّج",
  "menu.receipts": "الوصولات",
  "menu.balances": "الأرصدة والمستحقات",
  "menu.discounts": "التخفيضات والمنح",
  "menu.messaging": "المراسلة",
  "menu.emailSms": "البريد والرسائل القصيرة",
  "menu.reminders": "التذكيرات",
  "section.account": "الحساب",

  "menu.overview": "لوحة التحكم",
  "menu.students": "التلاميذ",
  "menu.teachers": "الأساتذة",
  "menu.subjects": "المواد",
  "menu.levels": "المستويات",
  "menu.groups": "الأفواج",
  "menu.programs": "التكوينات",
  "menu.hr": "الموارد البشرية",
  "menu.registrations": "التسجيلات",
  "menu.attendance": "الحضور",
  "menu.payments": "المدفوعات",
  "menu.pricing": "التكوينات والتسعيرة",
  "menu.invoices": "الفواتير",
  "menu.reports": "التقارير",
  "menu.settings": "الإعدادات",
  "menu.users": "المستخدمون",
  "menu.roles": "الأدوار",
  "menu.security": "الأمان",
  "menu.admin": "الإدارة",
  "menu.teacher": "فضاء الأستاذ",
  "menu.student": "فضاء التلميذ",
  "menu.registration": "التسجيل",
  "menu.support": "الدعم",

  "action.signIn": "تسجيل الدخول",
  "action.signOut": "تسجيل الخروج",
  "action.signUp": "إنشاء حساب",
  "action.getStarted": "ابدأ الآن",
  "action.back": "رجوع",
  "action.backHome": "العودة للرئيسية",
  "action.search": "بحث",
  "action.toggleSidebar": "إظهار أو إخفاء القائمة",
  "action.changeLanguage": "تغيير اللغة",

  "search.placeholder": "ابحث عن تلميذ أو فوج أو صفحة…",
  "search.hint": "بحث…",
  "search.empty": "لا توجد نتائج.",
  "search.pages": "الصفحات",
  "search.students": "التلاميذ",
  "search.teachers": "الأساتذة",
  "search.groups": "الأفواج",
  "search.subjects": "المواد",
  "search.registrations": "التسجيلات",

  "auth.welcome": "مرحبا بعودتك",
  "auth.loginSubtitle": "سجل الدخول للوصول إلى مركزك.",
  "auth.registerTitle": "أنشئ فضاءك",
  "auth.registerSubtitle": "معلومات بسيطة للانطلاق.",
  "auth.email": "البريد الإلكتروني",
  "auth.password": "كلمة المرور",
  "auth.fullName": "الاسم الكامل",
  "auth.role": "الدور",
  "auth.haveAccount": "لديك حساب بالفعل؟",
  "auth.noAccount": "ليس لديك حساب؟",
  "auth.demoNotice": "بياناتك محمية ومستضافة بشكل آمن.",

  "role.admin": "مدير",
  "role.teacher": "أستاذ",
  "role.student": "تلميذ",

  "state.comingSoon": "قريبا",
  "state.emptyTitle": "لا يوجد شيء لعرضه بعد",
  "state.emptyBody": "لا توجد بيانات لعرضها حاليًا.",

  "notFound.title": "الصفحة غير موجودة",
  "notFound.body": "هذه الصفحة غير موجودة أو تم نقلها.",
};

const en: Dictionary = {
  "brand.name": "Gestion École",
  "brand.tagline": "School management for tutoring centers",

  "nav.features": "Features",
  "nav.pricing": "Pricing",
  "nav.about": "About",
  "nav.login": "Sign in",
  "nav.register": "Create account",
  "nav.dashboard": "Dashboard",

  "section.general": "General",
  "section.management": "Management",
  "section.business": "Business",
  "section.settings": "Settings",
  "section.space": "My space",
  "section.pedagogy": "Teaching",
  "section.communication": "Communication",
  "menu.admissions": "Admissions",
  "menu.timetables": "Timetables",
  "menu.rooms": "Rooms",
  "menu.officialDocuments": "Official documents",
  "menu.statistics": "Statistics",
  "menu.lessonLog": "Lesson log",
  "menu.assessments": "Assessments",
  "menu.grades": "Grades & report cards",
  "menu.progression": "Progression",
  "menu.receipts": "Receipts",
  "menu.balances": "Balances & arrears",
  "menu.discounts": "Discounts & grants",
  "menu.messaging": "Messaging",
  "menu.emailSms": "Email & SMS",
  "menu.reminders": "Reminders",
  "section.account": "Account",

  "menu.overview": "Dashboard",
  "menu.students": "Students",
  "menu.teachers": "Teachers",
  "menu.subjects": "Subjects",
  "menu.levels": "Levels",
  "menu.groups": "Groups",
  "menu.programs": "Courses",
  "menu.hr": "Human resources",
  "menu.registrations": "Enrollments",
  "menu.attendance": "Attendance",
  "menu.payments": "Payments",
  "menu.pricing": "Courses & pricing",
  "menu.invoices": "Invoices",
  "menu.reports": "Reports",
  "menu.settings": "Settings",
  "menu.users": "Users",
  "menu.roles": "Roles",
  "menu.security": "Security",
  "menu.admin": "Administration",
  "menu.teacher": "Teacher space",
  "menu.student": "Student space",
  "menu.registration": "Enroll",
  "menu.support": "Support",

  "action.signIn": "Sign in",
  "action.signOut": "Sign out",
  "action.signUp": "Sign up",
  "action.getStarted": "Get started",
  "action.back": "Back",
  "action.backHome": "Back home",
  "action.search": "Search",
  "action.toggleSidebar": "Toggle navigation",
  "action.changeLanguage": "Change language",

  "search.placeholder": "Search a student, a group, a page…",
  "search.hint": "Search…",
  "search.empty": "No results.",
  "search.pages": "Pages",
  "search.students": "Students",
  "search.teachers": "Teachers",
  "search.groups": "Groups",
  "search.subjects": "Subjects",
  "search.registrations": "Registrations",

  "auth.welcome": "Welcome back",
  "auth.loginSubtitle": "Sign in to access your center.",
  "auth.registerTitle": "Create your space",
  "auth.registerSubtitle": "A few details to get started.",
  "auth.email": "Email address",
  "auth.password": "Password",
  "auth.fullName": "Full name",
  "auth.role": "Role",
  "auth.haveAccount": "Already have an account?",
  "auth.noAccount": "No account yet?",
  "auth.demoNotice": "Your data is protected and securely hosted.",

  "role.admin": "Administrator",
  "role.teacher": "Teacher",
  "role.student": "Student",

  "state.comingSoon": "Soon",
  "state.emptyTitle": "Nothing to show yet",
  "state.emptyBody": "No data to display yet.",

  "notFound.title": "Page not found",
  "notFound.body": "This page doesn't exist or has been moved.",
};

const modules = [
  landing,
  authPages,
  dashboard,
  entities,
  adminForms,
  feedback,
  workspace,
  onboarding,
  studentJourney,
  provisioning,
  lifecycle,
  teacherWorkspace,
  subjects,
  sessions,
  resources,
  payments,
  programs,
  enrollment,
  hr,
  roster,
  admissions,
  fees,
  finance,
  operations,
  pedagogy,
  communication,
  desktop,
];

function merge(locale: Locale, core: Dictionary): Dictionary {
  return Object.assign({}, core, ...modules.map((m) => m[locale]));
}

export const dictionaries: Record<Locale, Dictionary> = {
  fr: merge("fr", fr),
  ar: merge("ar", ar),
  en: merge("en", en),
};
