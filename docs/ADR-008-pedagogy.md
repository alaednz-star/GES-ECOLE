# ADR-008 — Pédagogie: Lesson Log, Assessments, Grades & Report Cards, Progression

**Status:** Accepted — implementation 2026-10-08 (local only, branch
`product-completion/pre-inscriptions`, not merged).
**Date:** 2026-10-08
**Builds on:**
- ADR-003: the session is `(group_id, session_date)`, derived from weekly slots and never stored.
- ADR-004: exams, grades and evaluations are in scope (this supersedes ADR-003's exclusion).
- Course resources: `chapters` per group.

## Context

The « Pédagogie » section had Présences, Rapport de présence and Ressources live, and four roadmap
entries: Cahier de textes, Évaluations, Notes & bulletins and Progression. Teachers already manage
their groups' chapters and attendance through the same permission (`can_manage_group`: an
administrator, or the group's teacher).

## Decisions

### Common rules

- **Who:**
  - Each group's teacher and administrators manage its pedagogy (`can_manage_group`, RLS).
  - Students read what concerns them: published scores, their remarks, and their groups' lesson log.
  - Other teachers and anonymous visitors see nothing.
  - The four sidebar entries are opened to teachers; their screens list only their own groups,
    and the database enforces it.
- **Session dates** (lesson log, assessments) follow the attendance rule. The date must fall
  inside the group's term and, when the group has slots, on one of its weekdays
  (`validate_session_date`).

### 1. Cahier de textes — `lesson_entries`

- **Shape:** one entry per session: `UNIQUE (group_id, session_date)`, the ADR-003 key.
- **Content:** what was covered (required), an optional chapter of the group, and optional
  homework with a due date (not before the session).
- **Page** `/dashboard/lesson-log`: pick a group, see its sessions held up to today (derived from
  slots) with the missing entries highlighted, then fill or edit an entry.

### 2. Évaluations — `assessments`, `assessment_scores`

- **Assessment:** group, title, kind (exam, test, quiz, homework, oral, project), date, maximum
  score (default 20, up to 100), coefficient (default 1, up to 10), and a published flag.
- **Score:** per student. Either a score between 0 and the maximum, or absent (never both), plus an
  optional comment. Only students with an approved enrollment in the group can be scored. Changing
  an assessment's maximum below an existing score is refused.
- **Visibility:** students see an assessment, and their own score, only once it is published.
- **Page** `/dashboard/assessments`: list with filters, create and edit, a score sheet for the
  roster (average, minimum, maximum), and publish.

### 3. Notes & bulletins — `academic_periods`, `report_comments`

- **Periods:** named date ranges (trimesters), managed by administrators and readable by every
  signed-in user. An assessment belongs to the period that contains its date; it has no foreign
  key, so moving period dates re-files assessments naturally.
- **Averages are DERIVED, never stored** (`grades-model.ts`, pure and tested):
  - each score is brought to /20 and weighted by its assessment's coefficient;
  - absences are excluded (not counted as zero);
  - this gives a group average per student, a class average, minimum, maximum and rank;
  - the general average is the mean of the student's group averages.
- **Remarks:** `report_comments(period, student, group or NULL)`.
  - Per group: written by its teacher or an administrator.
  - General (group NULL): written by administrators.
  - Students read their own.
- **Page** `/dashboard/grades`:
  - period selector and period management;
  - per group: the score matrix (students by assessments) with averages and ranks, and remarks;
  - per student: the report card, printable at `/documents/report-cards?period=&student=`.

### 4. Progression — derived, plus `chapters.completed_on`

- **Coverage per group:** a chapter counts as covered when a lesson entry references it or it is
  marked done (`completed_on`, by the group's teacher or an administrator).
- **Also shown per group:** sessions logged versus sessions held, and homework given.
- **Results across periods:** the class average per period and each student's evolution.
- **Page** `/dashboard/progression`.

## Not built

Competency-based assessment, automatic promotion decisions, parent access, notifications to
students when results are published, and a student-facing grades screen (RLS already allows
students to read their own published scores).
