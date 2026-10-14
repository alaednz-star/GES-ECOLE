import type { DictionaryModule } from "../types";

/**
 * Administration enrollment (ADR-004 section 4): placing a student in a group, withdrawing a
 * student, and the reasons the database gives when it says no. fr « inscription », ar « تسجيل »,
 * en "enrollment"; a group is « groupe » / « فوج » / "group".
 *
 * `ui.status.withdrawn` extends the shared StatusBadge vocabulary (registrations).
 */
export const enrollment: DictionaryModule = {
  fr: {
    "ui.status.withdrawn": "Retirée",

    "enroll.title": "Inscrire un élève",
    "enroll.inGroupAria": "Inscrire un élève dans {group}",
    "enroll.full": "Groupe complet",
    "enroll.placesLeft": "{count} place(s) libre(s) sur {seats}",
    "enroll.searchLabel": "Élève",
    "enroll.searchPlaceholder": "Nom, e-mail ou téléphone",
    "enroll.typeToSearch": "Tapez au moins 2 caractères pour rechercher un élève.",
    "enroll.results": "Élèves trouvés",
    "enroll.noMatch": "Aucun élève trouvé.",
    "enroll.newStudentHint":
      "Un nouvel élève crée d'abord son compte avec le lien d'inscription ; vous pourrez ensuite l'inscrire ici.",
    "enroll.alreadyHere": "Déjà inscrit dans ce groupe.",
    "enroll.pendingHere":
      "A déjà demandé une place dans ce groupe : vous pouvez approuver sa demande.",
    "enroll.notOnboarded":
      "Son profil n'est pas encore complété ; il peut néanmoins être inscrit dans ce groupe.",
    "enroll.willEnroll": "Sera inscrit dans « {group} » et prévenu par une notification.",
    "enroll.submit": "Inscrire",
    "enroll.approveRequest": "Approuver sa demande",
    "enroll.done": "{name} est inscrit dans « {group} ».",
    "enroll.error.alreadyInGroup":
      "Cet élève est déjà inscrit dans ce groupe ou y a une demande en attente.",
    "enroll.error.subjectTaken":
      "Cet élève est déjà inscrit dans « {group} » pour cette matière et ce niveau. Retirez-le de ce groupe d'abord.",
    "enroll.error.full": "Ce groupe est complet : aucune place libre.",
    "enroll.error.closed":
      "Cette inscription est close. Inscrivez l'élève à nouveau plutôt que de la modifier.",

    "withdraw.action": "Retirer",
    "withdraw.aria": "Retirer {name} du groupe",
    "withdraw.title": "Retirer l'élève du groupe ?",
    "withdraw.body":
      "{name} ne fera plus partie de « {group} » et sa place sera libérée. Son historique de présence et ses paiements sont conservés ; vous pourrez l'inscrire à nouveau plus tard.",
    "withdraw.reason": "Motif (facultatif)",
    "withdraw.reasonHint": "Visible par l'élève sur la page « Mes inscriptions ».",
    "withdraw.confirm": "Retirer du groupe",
    "withdraw.done": "{name} a été retiré du groupe.",
  },
  ar: {
    "ui.status.withdrawn": "منسحبة",

    "enroll.title": "تسجيل طالب",
    "enroll.inGroupAria": "تسجيل طالب في {group}",
    "enroll.full": "الفوج ممتلئ",
    "enroll.placesLeft": "{count} مقعد شاغر من أصل {seats}",
    "enroll.searchLabel": "الطالب",
    "enroll.searchPlaceholder": "الاسم أو البريد الإلكتروني أو الهاتف",
    "enroll.typeToSearch": "اكتب حرفين على الأقل للبحث عن طالب.",
    "enroll.results": "الطلاب الموجودون",
    "enroll.noMatch": "لم يُعثر على أي طالب.",
    "enroll.newStudentHint":
      "ينشئ الطالب الجديد حسابه أولاً عبر رابط التسجيل، ثم يمكنك تسجيله هنا.",
    "enroll.alreadyHere": "مسجّل مسبقًا في هذا الفوج.",
    "enroll.pendingHere": "طلب مقعدًا في هذا الفوج: يمكنك قبول طلبه.",
    "enroll.notOnboarded": "ملفه غير مكتمل بعد، ومع ذلك يمكن تسجيله في هذا الفوج.",
    "enroll.willEnroll": "سيُسجَّل في «{group}» ويصله إشعار.",
    "enroll.submit": "تسجيل",
    "enroll.approveRequest": "قبول طلبه",
    "enroll.done": "تم تسجيل {name} في «{group}».",
    "enroll.error.alreadyInGroup": "هذا الطالب مسجّل مسبقًا في هذا الفوج أو له طلب قيد الانتظار.",
    "enroll.error.subjectTaken":
      "هذا الطالب مسجّل في «{group}» لهذه المادة وهذا المستوى. انقله من ذلك الفوج أولاً.",
    "enroll.error.full": "هذا الفوج ممتلئ: لا يوجد مقعد شاغر.",
    "enroll.error.closed": "هذا التسجيل مغلق. سجّل الطالب من جديد بدل تعديله.",

    "withdraw.action": "سحب",
    "withdraw.aria": "سحب {name} من الفوج",
    "withdraw.title": "سحب الطالب من الفوج؟",
    "withdraw.body":
      "لن يبقى {name} ضمن «{group}» وسيتحرّر مقعده. يُحتفَظ بسجل حضوره ودفعاته، ويمكنك تسجيله من جديد لاحقًا.",
    "withdraw.reason": "السبب (اختياري)",
    "withdraw.reasonHint": "يراه الطالب في صفحة «تسجيلاتي».",
    "withdraw.confirm": "سحب من الفوج",
    "withdraw.done": "تم سحب {name} من الفوج.",
  },
  en: {
    "ui.status.withdrawn": "Withdrawn",

    "enroll.title": "Enroll a student",
    "enroll.inGroupAria": "Enroll a student in {group}",
    "enroll.full": "Group full",
    "enroll.placesLeft": "{count} place(s) left of {seats}",
    "enroll.searchLabel": "Student",
    "enroll.searchPlaceholder": "Name, email or phone",
    "enroll.typeToSearch": "Type at least 2 characters to search for a student.",
    "enroll.results": "Matching students",
    "enroll.noMatch": "No student found.",
    "enroll.newStudentHint":
      "A new student first creates their account with the registration link; you can then enroll them here.",
    "enroll.alreadyHere": "Already enrolled in this group.",
    "enroll.pendingHere":
      "Has already requested a place in this group: you can approve the request.",
    "enroll.notOnboarded":
      "Their profile is not complete yet; they can still be enrolled in this group.",
    "enroll.willEnroll": "Will be enrolled in “{group}” and notified.",
    "enroll.submit": "Enroll",
    "enroll.approveRequest": "Approve the request",
    "enroll.done": "{name} is enrolled in “{group}”.",
    "enroll.error.alreadyInGroup":
      "This student is already enrolled in this group or has a pending request in it.",
    "enroll.error.subjectTaken":
      "This student is already enrolled in “{group}” for this subject and level. Withdraw them from that group first.",
    "enroll.error.full": "This group is full: no place left.",
    "enroll.error.closed":
      "This enrollment is closed. Enroll the student again instead of changing it.",

    "withdraw.action": "Withdraw",
    "withdraw.aria": "Withdraw {name} from the group",
    "withdraw.title": "Withdraw the student from the group?",
    "withdraw.body":
      "{name} will no longer be part of “{group}” and their place is freed. Their attendance history and payments are kept; you can enroll them again later.",
    "withdraw.reason": "Reason (optional)",
    "withdraw.reasonHint": "Visible to the student on their “My enrollments” page.",
    "withdraw.confirm": "Withdraw from the group",
    "withdraw.done": "{name} has been withdrawn from the group.",
  },
};
