import type { DictionaryModule } from "../types";

/**
 * Error, confirmation and pending-state copy.
 *
 * Keys under `error.*` are produced by `lib/errors.ts` -> `toMessageKey()`.
 * Every message is written for the person using the app, not for a developer:
 * it says what happened and what to do next, and never exposes table names,
 * SQL codes, or internal identifiers.
 */
export const feedback: DictionaryModule = {
  fr: {
    // --- generic error surface ---
    "error.title": "Impossible de charger ces données",
    "error.retry": "Réessayer",
    "error.retrying": "Nouvelle tentative…",
    "error.backToDashboard": "Retour au tableau de bord",

    // --- mapped failures ---
    "error.generic": "Une erreur est survenue. Réessayez dans un instant.",
    "error.network": "Connexion au serveur impossible. Vérifiez votre connexion Internet.",
    "error.offline": "Vous êtes hors ligne. Reconnectez-vous pour continuer.",
    "error.server": "Le serveur rencontre un problème. Réessayez dans quelques instants.",
    "error.busy": "Le service est très sollicité. Réessayez dans un instant.",
    "error.rateLimited": "Trop de tentatives. Patientez une minute avant de réessayer.",
    "error.sessionExpired": "Votre session a expiré. Reconnectez-vous.",
    "error.forbidden": "Vous n'avez pas les droits nécessaires pour cette action.",
    "error.notFound": "Cet élément est introuvable. Il a peut-être été supprimé.",
    "error.duplicate": "Cet élément existe déjà.",
    "error.inUse": "Impossible de supprimer : cet élément est encore utilisé ailleurs.",
    "error.invalidValue": "Une des valeurs saisies n'est pas valide.",
    "error.missingField": "Un champ obligatoire est manquant.",
    "error.tooLong": "Une des valeurs saisies est trop longue.",
    "error.conflictRetry": "Un autre utilisateur a modifié ces données. Réessayez.",

    // --- auth ---
    "error.auth.invalidCredentials": "E-mail ou mot de passe incorrect.",
    "error.auth.emailNotConfirmed": "Confirmez votre e-mail avant de vous connecter.",
    "error.auth.emailTaken": "Un compte existe déjà avec cet e-mail.",
    "error.auth.weakPassword": "Mot de passe trop court (8 caractères minimum).",
    "error.auth.breachedPassword":
      "Ce mot de passe est trop courant et figure dans des fuites de données connues. Choisissez-en un autre, plus personnel.",
    "error.auth.invalidEmail": "Cette adresse e-mail n'est pas valide.",
    "error.auth.signupDisabled":
      "Les inscriptions sont temporairement fermées. Contactez le centre.",
    "error.auth.samePassword": "Le nouveau mot de passe doit être différent de l'ancien.",

    // --- pending / confirmation ---
    "ui.deleting": "Suppression…",
    "ui.saving": "Enregistrement…",
    "ui.loading": "Chargement…",
  },

  ar: {
    "error.title": "تعذّر تحميل هذه البيانات",
    "error.retry": "إعادة المحاولة",
    "error.retrying": "جارٍ إعادة المحاولة…",
    "error.backToDashboard": "العودة إلى لوحة التحكم",

    "error.generic": "حدث خطأ. أعد المحاولة بعد قليل.",
    "error.network": "تعذّر الاتصال بالخادم. تحقّق من اتصالك بالإنترنت.",
    "error.offline": "أنت غير متصل بالإنترنت. أعد الاتصال للمتابعة.",
    "error.server": "يواجه الخادم مشكلة. أعد المحاولة بعد قليل.",
    "error.busy": "الخدمة مشغولة حاليًا. أعد المحاولة بعد لحظات.",
    "error.rateLimited": "محاولات كثيرة جدًا. انتظر دقيقة ثم أعد المحاولة.",
    "error.sessionExpired": "انتهت صلاحية جلستك. الرجاء تسجيل الدخول من جديد.",
    "error.forbidden": "لا تملك الصلاحيات اللازمة لهذا الإجراء.",
    "error.notFound": "هذا العنصر غير موجود. ربما تم حذفه.",
    "error.duplicate": "هذا العنصر موجود بالفعل.",
    "error.inUse": "تعذّر الحذف: هذا العنصر ما يزال مستخدمًا في مكان آخر.",
    "error.invalidValue": "إحدى القيم المُدخلة غير صالحة.",
    "error.missingField": "حقل إلزامي ناقص.",
    "error.tooLong": "إحدى القيم المُدخلة طويلة جدًا.",
    "error.conflictRetry": "قام مستخدم آخر بتعديل هذه البيانات. أعد المحاولة.",

    "error.auth.invalidCredentials": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "error.auth.emailNotConfirmed": "أكّد بريدك الإلكتروني قبل تسجيل الدخول.",
    "error.auth.emailTaken": "يوجد حساب مسجّل بهذا البريد الإلكتروني.",
    "error.auth.weakPassword": "كلمة المرور قصيرة جدًا (8 أحرف على الأقل).",
    "error.auth.breachedPassword":
      "كلمة المرور هذه شائعة جدًا ووردت في تسريبات معروفة. اختر كلمة مرور أخرى أكثر خصوصية.",
    "error.auth.invalidEmail": "عنوان البريد الإلكتروني هذا غير صالح.",
    "error.auth.signupDisabled": "التسجيل مغلق مؤقتًا. اتصل بالمركز.",
    "error.auth.samePassword": "يجب أن تكون كلمة المرور الجديدة مختلفة عن القديمة.",

    "ui.deleting": "جارٍ الحذف…",
    "ui.saving": "جارٍ الحفظ…",
    "ui.loading": "جارٍ التحميل…",
  },

  en: {
    "error.title": "We couldn't load this data",
    "error.retry": "Try again",
    "error.retrying": "Retrying…",
    "error.backToDashboard": "Back to dashboard",

    "error.generic": "Something went wrong. Please try again in a moment.",
    "error.network": "Can't reach the server. Check your internet connection.",
    "error.offline": "You're offline. Reconnect to continue.",
    "error.server": "The server is having trouble. Please try again shortly.",
    "error.busy": "The service is busy right now. Try again in a moment.",
    "error.rateLimited": "Too many attempts. Wait a minute before trying again.",
    "error.sessionExpired": "Your session has expired. Please sign in again.",
    "error.forbidden": "You don't have permission to do that.",
    "error.notFound": "That item no longer exists. It may have been deleted.",
    "error.duplicate": "That item already exists.",
    "error.inUse": "Can't delete this: it's still being used elsewhere.",
    "error.invalidValue": "One of the values you entered isn't valid.",
    "error.missingField": "A required field is missing.",
    "error.tooLong": "One of the values you entered is too long.",
    "error.conflictRetry": "Someone else changed this data. Please try again.",

    "error.auth.invalidCredentials": "Incorrect email or password.",
    "error.auth.emailNotConfirmed": "Confirm your email address before signing in.",
    "error.auth.emailTaken": "An account with this email already exists.",
    "error.auth.weakPassword": "Password is too short (8 characters minimum).",
    "error.auth.breachedPassword":
      "That password is too common and appears in known data breaches. Please choose a more personal one.",
    "error.auth.invalidEmail": "That email address isn't valid.",
    "error.auth.signupDisabled": "Registrations are temporarily closed. Please contact the centre.",
    "error.auth.samePassword": "The new password must differ from the old one.",

    "ui.deleting": "Deleting…",
    "ui.saving": "Saving…",
    "ui.loading": "Loading…",
  },
};
