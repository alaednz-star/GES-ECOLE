# ADR-007 — School Operations: Rooms, Timetables, Official Documents, Statistics

**Status:** Accepted — implementation 2026-10-07 (local only, branch
`product-completion/pre-inscriptions`, not merged).
**Date:** 2026-10-07
**Builds on:** ADR-003 (weekly slots → sessions), ADR-004 (formations, groups, enrollments),
ADR-006 (document numbering, printable documents).

## Context

The sidebar's « Gestion » section had four roadmap entries: Emplois du temps, Salles, Documents
officiels and Statistiques. Most of what they need already existed:

- weekly slots, with a free-text `room` (`group_schedules`);
- teachers and levels on groups;
- attendance;
- the document numbering and printable-document frame from ADR-006.

## Decisions

### 1. Salles — `rooms`, linked to slots

- **Table:** `rooms(name unique, capacity, location, equipment, status)`. Signed-in users can read
  it (timetables); administrators write it (RLS, like subjects and levels).
- **Slot link:**
  - `group_schedules.room_id` points to a room (SET NULL on delete).
  - The existing `room` text is kept and synchronised with the room's name, so every screen that
    shows a slot's room keeps working.
  - A slot written with only a room name (the "new formation + first group" flow, older data) is
    linked to the room of that name by the same trigger. That trigger is named `a_…` so it fires
    before the conflict check.
- **Existing data:** each distinct free-text room became a room, and its slots were linked.
- **Rule:** a room hosts one active group at a time. Two slots of active groups whose terms overlap
  cannot use the same room, on the same weekday, at overlapping times
  (`t_group_schedules_room_conflict`, 23514 with a readable sentence).
- **Atomic slot saves:**
  - The group form used to delete all of a group's slots and then insert the new ones. A refused
    insert therefore left the group with no slots.
  - `replace_group_schedules(group, slots)` (SECURITY INVOKER, so RLS and every trigger still
    apply) now does both in one transaction.
  - The form passes the database error through unchanged, so the admin sees its sentence.
- **Page** `/dashboard/rooms`: rooms with their weekly hours and slot count, create, edit, deactivate,
  delete, and a link to the room's timetable. Rooms are chosen per slot in the group form (a
  dropdown replaces the free text).

### 2. Emplois du temps — derived, never typed twice

- **Source:** `/dashboard/timetables?view=all|group|teacher|room|level&id=…` builds the weekly grid
  from the active groups' slots (`timetable-model.ts`, pure and tested).
- **Layout:**
  - The week starts on Saturday (Algerian school week); Friday is shown only if used.
  - Overlapping blocks are laid out side by side.
  - Teachers booked in two places at once are flagged.
  - On a phone, the grid becomes a list by day.
- **Printable:** `/documents/timetables` (same URL state). The browser saves it as PDF.

### 3. Documents officiels — numbered certificates

- **Kinds:**
  - `enrollment`: « Attestation d'inscription »;
  - `attendance`: « Attestation d'assiduité », with present, late, excused and absent counts and
    the rate (late counts as attended, excused is left out);
  - `payment`: « Attestation de paiement », with the payments received.
- **Model:** `official_documents`, numbered `ATT-<year>-<000001>` through `document_sequences`.
  Like invoices, each one is a frozen snapshot (student identity including date of birth,
  enrollment, figures, issuer) that is never edited. Writes go only through
  `issue_official_document` and `void_official_document` (SECURITY DEFINER, admin check, audited
  `document_*`). Admins read all documents; a student reads their own.
- **Page** `/dashboard/official-documents`: list, filters, issue (student, then enrollment, then
  type), void with a reason. The printable certificate `/documents/certificates/$id` writes the
  snapshot as the certificate's text in the reader's language.

### 4. Statistiques — read-only figures

- **Data:** `/dashboard/statistics` derives everything from existing data (`stats-model.ts`, pure
  and tested): students, active and pending enrollments, groups' fill rate, attendance rate and its
  monthly trend, new enrollments per month, enrolled students by formation and by level, and
  teachers' weekly load.
- **View:** attendance comes from a `security_invoker` view, `attendance_monthly_stats`, with one
  row per month and group.
- **Money** stays in the financial reports (ADR-006); this page links to them.

### 5. Prices for every course (related correction)

`fee_templates.program_id` became nullable: a group without formation (a subject class such as
« 3AS Sciences — Mathématiques ») carries its own prices (`20261007100000`). There is still one
table, the same rules and the same charging on enrollment. « Formations & tarifs » lists
formations and these groups.

## Security

- Every new table has RLS. Clients have no write privilege on documents.
- Rooms are written by administrators through RLS.
- Every new function checks the administrator first (or runs as the invoker) and pins
  `search_path`.
- The views are `security_invoker`.
- The tests cover administrators, teachers, students and anonymous visitors
  (`verify-school-ops.sql`).

## Not built

Automatic timetable generation or optimisation, room booking outside weekly slots, a teacher or
student view of these pages, a diploma or end-of-course certificate (needs a `completed`
enrollment state), and exporting statistics as CSV.
