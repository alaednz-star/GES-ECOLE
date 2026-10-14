import type { DictionaryModule } from "../types";

/**
 * Session calendar vocabulary.
 *
 * Status keys mirror `SessionStatus` in
 * `src/features/school/session/types.ts` exactly -- the code carries the
 * locale-independent identity (`overdue`), this file carries its wording. Adding
 * a status means adding three entries here.
 */
export const sessions: DictionaryModule = {
  fr: {
    "entity.session.title": "Présences",
    "entity.session.description": "Cliquez sur une séance du calendrier pour pointer les élèves.",
    "entity.session.metaTitle": "Présences — Gestion École",
    "entity.session.metaDescription": "Le calendrier des séances : pointez en un clic.",

    // Counters
    "entity.session.counter.total": "séances",
    "entity.session.counter.toMark": "à pointer",
    "entity.session.counter.overdue": "en retard",

    // Toolbar
    "entity.session.today": "Aujourd'hui",
    "entity.session.previous": "Période précédente",
    "entity.session.next": "Période suivante",
    "entity.session.viewWeek": "Semaine",
    "entity.session.viewMonth": "Mois",
    "entity.session.toMarkOnly": "À pointer seulement",
    "entity.session.allTeachers": "Tous les enseignants",
    "entity.session.teacherFilter": "Enseignant",

    // Statuses
    "entity.session.status.complete": "{marked}/{enrolled} pointés",
    "entity.session.status.partial": "{marked}/{enrolled} pointés",
    "entity.session.status.overdue": "Non pointée",
    "entity.session.status.due": "À pointer",
    "entity.session.status.scheduled": "Programmée",
    "entity.session.status.empty": "Aucun élève inscrit",
    "entity.session.status.cancelled": "Annulée",

    // Calendar
    "entity.session.parallelCount": "{count} groupes en parallèle",
    "entity.session.noSessions": "Aucune séance",
    "entity.session.emptyPeriod": "Aucune séance sur cette période.",
    "entity.session.emptyPeriodFiltered":
      "Aucune séance à pointer sur cette période. Désactivez le filtre pour tout voir.",
    "entity.session.moreSessions": "+{count} autre",
    "entity.session.moreSessionsPlural": "+{count} autres",
    "entity.session.legend": "Matières",

    // Drawer
    "entity.session.drawer.close": "Fermer",
    "entity.session.drawer.allPresent": "Tout présent",
    "entity.session.drawer.reset": "Réinitialiser",
    "entity.session.drawer.markedCount": "{marked}/{enrolled} pointés",
    "entity.session.drawer.save": "Enregistrer",
    "entity.session.drawer.saving": "Enregistrement…",
    "entity.session.drawer.saved": "Présences enregistrées.",
    "entity.session.drawer.missing": "{count} élève(s) sans statut",
    "entity.session.drawer.ready": "Prêt à enregistrer",
    "entity.session.drawer.noChanges": "Aucune modification à enregistrer.",
    "entity.session.drawer.discard":
      "Vous avez des présences non enregistrées. Continuer et les perdre ?",
    "entity.session.drawer.noStudents": "Aucun élève inscrit dans ce groupe.",
    "entity.session.drawer.noStudentsHint":
      "Ajoutez des inscriptions pour pouvoir pointer cette séance.",
    "entity.session.drawer.goToRegistrations": "Aller aux inscriptions",
    "entity.session.drawer.readOnly": "Vous ne pouvez pas modifier les présences de cette séance.",
    "entity.session.drawer.room": "Salle",
    "entity.session.drawer.teacher": "Enseignant",
    "entity.session.drawer.enrolled": "Élèves inscrits",
    "entity.session.drawer.legend": "P Présent · A Absent · R Retard · E Excusé",
    "entity.session.drawer.previousSession": "Séance précédente",
    "entity.session.drawer.nextSession": "Séance suivante",
    "entity.session.drawer.queuePosition": "Séance {index} sur {total}",
    "entity.session.drawer.jumpToUnmarked": "Aller aux {count} non pointés",
    "entity.session.drawer.unsavedRow": "Modification non enregistrée",
    "entity.session.drawer.unsavedCount": "{count} modification(s) non enregistrée(s)",
    "entity.session.drawer.saveFailed": "L'enregistrement a échoué. Vos saisies sont conservées.",
    "entity.session.drawer.retry": "Réessayer",
    "entity.session.drawer.keyboardHint":
      "Clavier : P A R E pour pointer et passer au suivant, ↑ ↓ pour naviguer, Ctrl+S pour enregistrer.",

    // Per-status short codes for the P/A/R/E buttons.
    "entity.session.code.present": "P",
    "entity.session.code.absent": "A",
    "entity.session.code.late": "R",
    "entity.session.code.excused": "E",
  },

  ar: {
    "entity.session.title": "الحضور",
    "entity.session.description": "اضغط على حصة في التقويم لتسجيل حضور الطلاب.",
    "entity.session.metaTitle": "الحضور — Gestion École",
    "entity.session.metaDescription": "تقويم الحصص: سجّل الحضور بنقرة واحدة.",

    "entity.session.counter.total": "حصص",
    "entity.session.counter.toMark": "بحاجة للتسجيل",
    "entity.session.counter.overdue": "متأخرة",

    "entity.session.today": "اليوم",
    "entity.session.previous": "الفترة السابقة",
    "entity.session.next": "الفترة التالية",
    "entity.session.viewWeek": "أسبوع",
    "entity.session.viewMonth": "شهر",
    "entity.session.toMarkOnly": "بحاجة للتسجيل فقط",
    "entity.session.allTeachers": "كل الأساتذة",
    "entity.session.teacherFilter": "الأستاذ",

    "entity.session.status.complete": "{marked}/{enrolled} مسجّل",
    "entity.session.status.partial": "{marked}/{enrolled} مسجّل",
    "entity.session.status.overdue": "غير مسجّلة",
    "entity.session.status.due": "بحاجة للتسجيل",
    "entity.session.status.scheduled": "مبرمجة",
    "entity.session.status.empty": "لا يوجد طالب مسجَّل",
    "entity.session.status.cancelled": "ملغاة",

    "entity.session.parallelCount": "{count} أفواج متوازية",
    "entity.session.noSessions": "لا توجد حصص",
    "entity.session.emptyPeriod": "لا توجد حصص في هذه الفترة.",
    "entity.session.emptyPeriodFiltered":
      "لا توجد حصص بحاجة للتسجيل في هذه الفترة. أوقف الفلتر لعرض الكل.",
    "entity.session.moreSessions": "+{count} أخرى",
    "entity.session.moreSessionsPlural": "+{count} أخرى",
    "entity.session.legend": "المواد",

    "entity.session.drawer.close": "إغلاق",
    "entity.session.drawer.allPresent": "الجميع حاضر",
    "entity.session.drawer.reset": "إعادة تعيين",
    "entity.session.drawer.markedCount": "{marked}/{enrolled} مسجّل",
    "entity.session.drawer.save": "حفظ",
    "entity.session.drawer.saving": "جارٍ الحفظ…",
    "entity.session.drawer.saved": "تم حفظ الحضور.",
    "entity.session.drawer.missing": "{count} طالب بدون حالة",
    "entity.session.drawer.ready": "جاهز للحفظ",
    "entity.session.drawer.noChanges": "لا توجد تغييرات للحفظ.",
    "entity.session.drawer.discard": "لديك حضور غير محفوظ. المتابعة وفقدانه؟",
    "entity.session.drawer.noStudents": "لا يوجد أي طالب مسجَّل في هذا الفوج.",
    "entity.session.drawer.noStudentsHint": "أضف تسجيلات لتتمكن من تسجيل حضور هذه الحصة.",
    "entity.session.drawer.goToRegistrations": "الانتقال إلى التسجيلات",
    "entity.session.drawer.readOnly": "لا يمكنك تعديل حضور هذه الحصة.",
    "entity.session.drawer.room": "القاعة",
    "entity.session.drawer.teacher": "الأستاذ",
    "entity.session.drawer.enrolled": "الطلاب المسجّلون",
    "entity.session.drawer.legend": "ح حاضر · غ غائب · م متأخر · ع معذور",
    "entity.session.drawer.previousSession": "الحصة السابقة",
    "entity.session.drawer.nextSession": "الحصة التالية",
    "entity.session.drawer.queuePosition": "الحصة {index} من {total}",
    "entity.session.drawer.jumpToUnmarked": "الانتقال إلى {count} غير مسجّل",
    "entity.session.drawer.unsavedRow": "تعديل غير محفوظ",
    "entity.session.drawer.unsavedCount": "{count} تعديل غير محفوظ",
    "entity.session.drawer.saveFailed": "فشل الحفظ. تم الاحتفاظ بإدخالاتك.",
    "entity.session.drawer.retry": "إعادة المحاولة",
    "entity.session.drawer.keyboardHint":
      "لوحة المفاتيح: ح غ م ع للتسجيل والانتقال، ↑ ↓ للتنقل، Ctrl+S للحفظ.",

    "entity.session.code.present": "ح",
    "entity.session.code.absent": "غ",
    "entity.session.code.late": "م",
    "entity.session.code.excused": "ع",
  },

  en: {
    "entity.session.title": "Attendance",
    "entity.session.description": "Click a session in the calendar to mark students.",
    "entity.session.metaTitle": "Attendance — Gestion École",
    "entity.session.metaDescription": "The session calendar: mark attendance in one click.",

    "entity.session.counter.total": "sessions",
    "entity.session.counter.toMark": "to mark",
    "entity.session.counter.overdue": "overdue",

    "entity.session.today": "Today",
    "entity.session.previous": "Previous period",
    "entity.session.next": "Next period",
    "entity.session.viewWeek": "Week",
    "entity.session.viewMonth": "Month",
    "entity.session.toMarkOnly": "To mark only",
    "entity.session.allTeachers": "All teachers",
    "entity.session.teacherFilter": "Teacher",

    "entity.session.status.complete": "{marked}/{enrolled} marked",
    "entity.session.status.partial": "{marked}/{enrolled} marked",
    "entity.session.status.overdue": "Not marked",
    "entity.session.status.due": "To mark",
    "entity.session.status.scheduled": "Scheduled",
    "entity.session.status.empty": "No enrolled students",
    "entity.session.status.cancelled": "Cancelled",

    "entity.session.parallelCount": "{count} parallel groups",
    "entity.session.noSessions": "No sessions",
    "entity.session.emptyPeriod": "No sessions in this period.",
    "entity.session.emptyPeriodFiltered":
      "No sessions to mark in this period. Turn off the filter to see everything.",
    "entity.session.moreSessions": "+{count} more",
    "entity.session.moreSessionsPlural": "+{count} more",
    "entity.session.legend": "Subjects",

    "entity.session.drawer.close": "Close",
    "entity.session.drawer.allPresent": "All present",
    "entity.session.drawer.reset": "Reset",
    "entity.session.drawer.markedCount": "{marked}/{enrolled} marked",
    "entity.session.drawer.save": "Save",
    "entity.session.drawer.saving": "Saving…",
    "entity.session.drawer.saved": "Attendance saved.",
    "entity.session.drawer.missing": "{count} student(s) without a status",
    "entity.session.drawer.ready": "Ready to save",
    "entity.session.drawer.noChanges": "No changes to save.",
    "entity.session.drawer.discard": "You have unsaved attendance. Continue and lose it?",
    "entity.session.drawer.noStudents": "No students enrolled in this group.",
    "entity.session.drawer.noStudentsHint": "Add registrations to be able to mark this session.",
    "entity.session.drawer.goToRegistrations": "Go to registrations",
    "entity.session.drawer.readOnly": "You cannot modify attendance for this session.",
    "entity.session.drawer.room": "Room",
    "entity.session.drawer.teacher": "Teacher",
    "entity.session.drawer.enrolled": "Enrolled students",
    "entity.session.drawer.legend": "P Present · A Absent · L Late · E Excused",
    "entity.session.drawer.previousSession": "Previous session",
    "entity.session.drawer.nextSession": "Next session",
    "entity.session.drawer.queuePosition": "Session {index} of {total}",
    "entity.session.drawer.jumpToUnmarked": "Go to {count} unmarked",
    "entity.session.drawer.unsavedRow": "Unsaved change",
    "entity.session.drawer.unsavedCount": "{count} unsaved change(s)",
    "entity.session.drawer.saveFailed": "Saving failed. Your entries are kept.",
    "entity.session.drawer.retry": "Retry",
    "entity.session.drawer.keyboardHint":
      "Keyboard: P A L E to mark and advance, ↑ ↓ to move, Ctrl+S to save.",

    "entity.session.code.present": "P",
    "entity.session.code.absent": "A",
    "entity.session.code.late": "L",
    "entity.session.code.excused": "E",
  },
};
