import type { DictionaryModule } from "../types";

/**
 * Entity lifecycle: actions menu, confirmation dialogs, dependency
 * explanations. Deliberately generic ("this account") so the same strings serve
 * students and future entities without a second dictionary.
 */
export const lifecycle: DictionaryModule = {
  fr: {
    "actions.viewProfile": "Voir le profil",
    "actions.edit": "Modifier",
    "actions.resetPassword": "Réinitialiser le mot de passe",
    "actions.suspend": "Suspendre",
    "actions.reactivate": "Réactiver",
    "actions.archive": "Archiver",
    "actions.restore": "Restaurer",
    "actions.delete": "Supprimer définitivement",
    "entity.teachers.actionsFor": "Actions pour {name}",

    "ui.status.suspended": "Suspendu",
    "ui.status.archived": "Archivé",

    "lifecycle.reason": "Motif",
    "lifecycle.reasonPlaceholder": "Congé, enquête interne…",
    "lifecycle.checkingDependencies": "Vérification des données liées…",

    "lifecycle.suspend.title": "Suspendre ce compte ?",
    "lifecycle.suspend.body": "{name} ne pourra plus se connecter, mais rien ne sera supprimé.",
    "lifecycle.suspend.confirm": "Suspendre",
    "lifecycle.suspend.done": "Compte suspendu.",

    "lifecycle.reactivate.title": "Réactiver ce compte ?",
    "lifecycle.reactivate.body": "{name} pourra de nouveau se connecter.",
    "lifecycle.reactivate.confirm": "Réactiver",
    "lifecycle.reactivate.done": "Compte réactivé.",

    "lifecycle.archive.title": "Archiver ce compte ?",
    "lifecycle.archive.body":
      "{name} quittera les listes courantes mais restera dans les rapports et l'historique.",
    "lifecycle.archive.confirm": "Archiver",
    "lifecycle.archive.done": "Compte archivé.",

    "lifecycle.restore.title": "Restaurer ce compte ?",
    "lifecycle.restore.body": "{name} redeviendra actif et réapparaîtra dans les listes.",
    "lifecycle.restore.confirm": "Restaurer",
    "lifecycle.restore.done": "Compte restauré.",

    "lifecycle.resetPassword.title": "Réinitialiser le mot de passe ?",
    "lifecycle.resetPassword.body":
      "Un mot de passe temporaire sera généré pour {name} et affiché une seule fois.",
    "lifecycle.resetPassword.confirm": "Réinitialiser",
    "lifecycle.resetPassword.done": "Mot de passe réinitialisé.",

    "lifecycle.delete.title": "Supprimer définitivement ?",
    "lifecycle.delete.body":
      "Cette action est irréversible. {name} et son compte de connexion seront supprimés.",
    "lifecycle.delete.confirm": "Supprimer définitivement",
    "lifecycle.delete.done": "Compte supprimé.",
    "lifecycle.delete.blocked": "Suppression impossible : des données sont rattachées.",
    "lifecycle.delete.preserved": "Conservé après la suppression :",
    "lifecycle.delete.archiveInstead":
      "Archivez plutôt ce compte : l'historique reste consultable.",
    "lifecycle.delete.safe": "Aucune donnée rattachée. La suppression est sûre.",

    "lifecycle.effect.blocksLogin": "La connexion sera bloquée",
    "lifecycle.effect.restoresLogin": "La connexion sera rétablie",
    "lifecycle.effect.hidesFromLists": "Le compte disparaîtra des listes courantes",
    "lifecycle.effect.showsInLists": "Le compte réapparaîtra dans les listes",
    "lifecycle.effect.keepsGroups": "Les groupes assignés sont conservés",
    "lifecycle.effect.keepsAttendance": "L'historique de présence est conservé",
    "lifecycle.effect.keepsAudit": "Le journal d'audit est conservé",
    "lifecycle.effect.keepsReports": "Les rapports restent disponibles",
    "lifecycle.effect.newTempPassword": "Un mot de passe temporaire sera généré",
    "lifecycle.effect.forcesChange": "Un changement sera exigé à la connexion",
    "lifecycle.effect.keepsEverythingElse": "Rien d'autre n'est modifié",
    "lifecycle.effect.permanent": "L'action est irréversible",
    "lifecycle.effect.removesLogin": "Le compte de connexion sera supprimé",
    "lifecycle.effect.auditSurvives": "Le journal d'audit est conservé",

    "lifecycle.dependency.groups": "{count} groupe(s) assigné(s)",
    "lifecycle.dependency.attendance": "{count} présence(s) enregistrée(s)",
    "lifecycle.dependency.student_notes": "{count} note(s) pédagogique(s)",
    "lifecycle.dependency.audit_log": "{count} entrée(s) d'audit",
    "lifecycle.dependency.registrations": "{count} inscription(s)",
    "lifecycle.dependency.teacher_subjects": "{count} matière(s) enseignée(s)",
    "lifecycle.dependency.employees": "{count} dossier RH (contrats, temps, congés, documents)",
  },

  ar: {
    "actions.viewProfile": "عرض الملف",
    "actions.edit": "تعديل",
    "actions.resetPassword": "إعادة تعيين كلمة المرور",
    "actions.suspend": "تعليق",
    "actions.reactivate": "إعادة التفعيل",
    "actions.archive": "أرشفة",
    "actions.restore": "استعادة",
    "actions.delete": "حذف نهائي",
    "entity.teachers.actionsFor": "إجراءات {name}",

    "ui.status.suspended": "معلّق",
    "ui.status.archived": "مؤرشف",

    "lifecycle.reason": "السبب",
    "lifecycle.reasonPlaceholder": "عطلة، تحقيق داخلي…",
    "lifecycle.checkingDependencies": "جارٍ التحقق من البيانات المرتبطة…",

    "lifecycle.suspend.title": "تعليق هذا الحساب؟",
    "lifecycle.suspend.body": "لن يتمكن {name} من تسجيل الدخول، ولن يُحذف أي شيء.",
    "lifecycle.suspend.confirm": "تعليق",
    "lifecycle.suspend.done": "تم تعليق الحساب.",

    "lifecycle.reactivate.title": "إعادة تفعيل هذا الحساب؟",
    "lifecycle.reactivate.body": "سيتمكن {name} من تسجيل الدخول مجددًا.",
    "lifecycle.reactivate.confirm": "إعادة التفعيل",
    "lifecycle.reactivate.done": "تمت إعادة تفعيل الحساب.",

    "lifecycle.archive.title": "أرشفة هذا الحساب؟",
    "lifecycle.archive.body": "سيختفي {name} من القوائم الحالية لكنه يبقى في التقارير والسجل.",
    "lifecycle.archive.confirm": "أرشفة",
    "lifecycle.archive.done": "تمت أرشفة الحساب.",

    "lifecycle.restore.title": "استعادة هذا الحساب؟",
    "lifecycle.restore.body": "سيعود {name} نشطًا ويظهر في القوائم.",
    "lifecycle.restore.confirm": "استعادة",
    "lifecycle.restore.done": "تمت استعادة الحساب.",

    "lifecycle.resetPassword.title": "إعادة تعيين كلمة المرور؟",
    "lifecycle.resetPassword.body": "ستُولَّد كلمة مرور مؤقتة لـ {name} وتُعرض مرة واحدة فقط.",
    "lifecycle.resetPassword.confirm": "إعادة التعيين",
    "lifecycle.resetPassword.done": "تمت إعادة تعيين كلمة المرور.",

    "lifecycle.delete.title": "حذف نهائي؟",
    "lifecycle.delete.body": "لا يمكن التراجع. سيُحذف {name} وحساب الدخول الخاص به.",
    "lifecycle.delete.confirm": "حذف نهائي",
    "lifecycle.delete.done": "تم حذف الحساب.",
    "lifecycle.delete.blocked": "تعذّر الحذف: توجد بيانات مرتبطة.",
    "lifecycle.delete.preserved": "يُحتفظ به بعد الحذف:",
    "lifecycle.delete.archiveInstead": "استعمل الأرشفة بدل الحذف: يبقى السجل متاحًا.",
    "lifecycle.delete.safe": "لا توجد بيانات مرتبطة. الحذف آمن.",

    "lifecycle.effect.blocksLogin": "سيُمنع تسجيل الدخول",
    "lifecycle.effect.restoresLogin": "سيُستعاد تسجيل الدخول",
    "lifecycle.effect.hidesFromLists": "سيختفي الحساب من القوائم الحالية",
    "lifecycle.effect.showsInLists": "سيظهر الحساب في القوائم مجددًا",
    "lifecycle.effect.keepsGroups": "تبقى الأفواج المسندة كما هي",
    "lifecycle.effect.keepsAttendance": "يبقى سجل الحضور محفوظًا",
    "lifecycle.effect.keepsAudit": "يبقى سجل التدقيق محفوظًا",
    "lifecycle.effect.keepsReports": "تبقى التقارير متاحة",
    "lifecycle.effect.newTempPassword": "ستُولَّد كلمة مرور مؤقتة",
    "lifecycle.effect.forcesChange": "سيُطلب تغييرها عند تسجيل الدخول",
    "lifecycle.effect.keepsEverythingElse": "لن يتغير أي شيء آخر",
    "lifecycle.effect.permanent": "لا يمكن التراجع عن الإجراء",
    "lifecycle.effect.removesLogin": "سيُحذف حساب الدخول",
    "lifecycle.effect.auditSurvives": "يبقى سجل التدقيق محفوظًا",

    "lifecycle.dependency.groups": "{count} فوج مسند",
    "lifecycle.dependency.attendance": "{count} تسجيل حضور",
    "lifecycle.dependency.student_notes": "{count} ملاحظة تربوية",
    "lifecycle.dependency.audit_log": "{count} إدخال تدقيق",
    "lifecycle.dependency.registrations": "{count} تسجيل",
    "lifecycle.dependency.teacher_subjects": "{count} مادة",
    "lifecycle.dependency.employees": "{count} ملف موارد بشرية (عقود، وقت عمل، عطل، وثائق)",
  },

  en: {
    "actions.viewProfile": "View profile",
    "actions.edit": "Edit",
    "actions.resetPassword": "Reset password",
    "actions.suspend": "Suspend",
    "actions.reactivate": "Reactivate",
    "actions.archive": "Archive",
    "actions.restore": "Restore",
    "actions.delete": "Delete permanently",
    "entity.teachers.actionsFor": "Actions for {name}",

    "ui.status.suspended": "Suspended",
    "ui.status.archived": "Archived",

    "lifecycle.reason": "Reason",
    "lifecycle.reasonPlaceholder": "Leave, internal review…",
    "lifecycle.checkingDependencies": "Checking linked records…",

    "lifecycle.suspend.title": "Suspend this account?",
    "lifecycle.suspend.body": "{name} will not be able to sign in. Nothing is deleted.",
    "lifecycle.suspend.confirm": "Suspend",
    "lifecycle.suspend.done": "Account suspended.",

    "lifecycle.reactivate.title": "Reactivate this account?",
    "lifecycle.reactivate.body": "{name} will be able to sign in again.",
    "lifecycle.reactivate.confirm": "Reactivate",
    "lifecycle.reactivate.done": "Account reactivated.",

    "lifecycle.archive.title": "Archive this account?",
    "lifecycle.archive.body":
      "{name} will leave the working lists but stay in reports and history.",
    "lifecycle.archive.confirm": "Archive",
    "lifecycle.archive.done": "Account archived.",

    "lifecycle.restore.title": "Restore this account?",
    "lifecycle.restore.body": "{name} becomes active again and reappears in lists.",
    "lifecycle.restore.confirm": "Restore",
    "lifecycle.restore.done": "Account restored.",

    "lifecycle.resetPassword.title": "Reset the password?",
    "lifecycle.resetPassword.body":
      "A temporary password will be generated for {name} and shown once.",
    "lifecycle.resetPassword.confirm": "Reset",
    "lifecycle.resetPassword.done": "Password reset.",

    "lifecycle.delete.title": "Delete permanently?",
    "lifecycle.delete.body":
      "This cannot be undone. {name} and their sign-in account will be removed.",
    "lifecycle.delete.confirm": "Delete permanently",
    "lifecycle.delete.done": "Account deleted.",
    "lifecycle.delete.blocked": "Cannot delete: linked records exist.",
    "lifecycle.delete.preserved": "Kept after deletion:",
    "lifecycle.delete.archiveInstead": "Archive instead — the history stays available.",
    "lifecycle.delete.safe": "No linked records. Deletion is safe.",

    "lifecycle.effect.blocksLogin": "Sign-in will be blocked",
    "lifecycle.effect.restoresLogin": "Sign-in will be restored",
    "lifecycle.effect.hidesFromLists": "Hidden from working lists",
    "lifecycle.effect.showsInLists": "Visible in lists again",
    "lifecycle.effect.keepsGroups": "Assigned groups are kept",
    "lifecycle.effect.keepsAttendance": "Attendance history is kept",
    "lifecycle.effect.keepsAudit": "Audit trail is kept",
    "lifecycle.effect.keepsReports": "Reports stay available",
    "lifecycle.effect.newTempPassword": "A temporary password is generated",
    "lifecycle.effect.forcesChange": "A change is required at next sign-in",
    "lifecycle.effect.keepsEverythingElse": "Nothing else changes",
    "lifecycle.effect.permanent": "This cannot be undone",
    "lifecycle.effect.removesLogin": "The sign-in account is removed",
    "lifecycle.effect.auditSurvives": "Audit trail is kept",

    "lifecycle.dependency.groups": "{count} assigned group(s)",
    "lifecycle.dependency.attendance": "{count} attendance record(s)",
    "lifecycle.dependency.student_notes": "{count} teaching note(s)",
    "lifecycle.dependency.audit_log": "{count} audit entr(ies)",
    "lifecycle.dependency.registrations": "{count} registration(s)",
    "lifecycle.dependency.teacher_subjects": "{count} subject(s) taught",
    "lifecycle.dependency.employees": "{count} HR file (contracts, time, leave, documents)",
  },
};
