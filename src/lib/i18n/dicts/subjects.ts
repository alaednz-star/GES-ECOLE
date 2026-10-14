import type { DictionaryModule } from "../types";

/**
 * Subject display names, keyed by the STABLE key stored in `subjects.key`.
 *
 * The database stores `mathematics`, never "Mathématiques": business data must
 * not depend on the display language, otherwise the same subject reads
 * differently per locale and cannot be matched across them. The key is the
 * identity; these strings are presentation only.
 *
 * A subject whose key has no entry here falls back to `subjects.name`, so an
 * admin creating a custom subject still sees something sensible.
 */
export const subjects: DictionaryModule = {
  fr: {
    "subject.mathematics": "Mathématiques",
    "subject.physics": "Physique",
    "subject.natural_sciences": "Sciences Naturelles",
    "subject.arabic": "Arabe",
    "subject.french": "Français",
    "subject.english": "Anglais",
    "subjectDomain.languages": "Langues",
    "subjectDomain.school_subjects": "Matières scolaires",
    "subjectDomain.computing": "Informatique et technologie",
    "subjectDomain.professional": "Professionnel et technique",
    "subjectDomain.other": "Autre / non classée",
  },
  ar: {
    "subject.mathematics": "الرياضيات",
    "subject.physics": "الفيزياء",
    "subject.natural_sciences": "العلوم الطبيعية",
    "subject.arabic": "اللغة العربية",
    "subject.french": "اللغة الفرنسية",
    "subject.english": "اللغة الإنجليزية",
    "subjectDomain.languages": "اللغات",
    "subjectDomain.school_subjects": "المواد الدراسية",
    "subjectDomain.computing": "الإعلام الآلي والتكنولوجيا",
    "subjectDomain.professional": "المهني والتقني",
    "subjectDomain.other": "أخرى / غير مصنّفة",
  },
  en: {
    "subject.mathematics": "Mathematics",
    "subject.physics": "Physics",
    "subject.natural_sciences": "Natural Sciences",
    "subject.arabic": "Arabic",
    "subject.french": "French",
    "subject.english": "English",
    "subjectDomain.languages": "Languages",
    "subjectDomain.school_subjects": "School subjects",
    "subjectDomain.computing": "Computing and technology",
    "subjectDomain.professional": "Professional and technical",
    "subjectDomain.other": "Other / unclassified",
  },
};
