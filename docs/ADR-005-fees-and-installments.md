# ADR-005 — Fees and Installments: What an Enrollment Owes

**Status:** Accepted — first implementation 2026-10-06 (local only, branch
`product-completion/pre-inscriptions`, not merged).
**Date:** 2026-10-06
**Related:** [ADR-004](./ADR-004-formation-architecture.md) section 9 (Finance), migrations
`20260820100000_student_payments.sql`, `20260930100100_payment_management.sql`,
`20261006100000_fee_audit_actions.sql`, `20261006100100_fees_installments.sql`.
**Refines:** ADR-004 section 9 (see "Relation to ADR-004" below).

## Context

Gestion École records money **received** (`payments`, one row per transaction against an approved
enrollment). It recorded nothing about money **owed**, so no screen could answer "what does this
student still have to pay?". The Payments page says so explicitly, and `groups.price_dzd` is a
price without a period that cannot be turned into an obligation honestly.

Families in Algerian schools and training centres typically owe a registration fee, a course fee
paid in one go or in monthly or termly installments, and occasional items (books, an exam, transport,
the canteen, insurance). They pay irregularly: two installments at once, half of one, or ahead.

## Decision

### 1. Four concepts, never merged

| Concept | Meaning | Stored as |
|---|---|---|
| **Fee / charge** | what is owed: an amount of a fee type, on one enrollment | `charges` |
| **Installment** | a dated part of a charge | `charge_installments` |
| **Payment** | money received on an enrollment | `payments` (unchanged) |
| **Balance** | owed minus received | **derived, never stored** |

A payment is never a fee and never creates one. The Payments architecture (table, policies, audit
trigger, ledger screen) is unchanged.

### 2. The obligation belongs to the enrollment

`charges.registration_id → registrations` (ON DELETE **RESTRICT**, like payments). Not the
formation: two students of the same group can owe different amounts (a sibling discount, a late
start), and payments are already recorded against the enrollment, so owed and paid meet on the
same row. A new charge requires an **approved** enrollment. A withdrawn enrollment keeps its
charges (the administration cancels them if they are no longer due); it cannot receive new ones.

### 3. Fee types are data

`fee_types(code, name, built_in, status, position)`, the same shape as `formation_types`. Built-in
types are translated by code (fr/ar/en): `registration`, `tuition`, `materials`, `exam`,
`insurance`, `transport`, `canteen`, `other`. `other` requires a label on the charge
(`charges_other_labelled`). Types are **read-only for clients** in this phase. Custom types need
only a management screen and write policies, because the table, the name column and the
code-or-name display (`fee-labels.ts`) already support them. An inactive type stays valid on
existing charges and cannot be given to a new one.

### 4. Installments

Every charge has **1 to 24** installments; a single due date is a one-installment schedule, so
every obligation has a due date. Integrity:

- amounts are whole dinars `> 0` (charge and installment);
- `due_on` is between 2000-01-01 and 2100-12-31, with no two installments of a charge on the same day;
- positions are 1..n in due-date order;
- the installments add up **exactly** to the charge.

The last two rules are a **deferred constraint trigger** (`check_charge_schedule`), checked at
commit, so a charge and its schedule are written in one transaction in any order, and no path
(PostgREST, Studio, a script) can leave a schedule that does not add up.

### 5. Lifecycle: cancel, never delete

`status` is `active` or `cancelled`. Cancelling records who, when and a mandatory reason (1–300
characters) and is final: a corrected obligation is a new charge. The duplicate guard is a partial
unique index on (enrollment, fee type, label) over **active** charges, so a cancelled charge does
not block entering the corrected one. Clients cannot delete a charge or an installment at all.
Editing an active charge replaces its amount and whole schedule together, and the change is
audited before and after. A trigger freezes cancelled charges and their installments and forbids
moving a charge to another enrollment, whoever writes.

### 6. Security

- **Read:** administrators read every charge; a student reads the charges of their own enrollments
  (RLS); teachers, including the teacher of the group, read none.
- **Write:** administrators only, and only through `save_charge` and `cancel_charge` (SECURITY
  DEFINER, administrator check first, pinned `search_path`, EXECUTE revoked from `anon`).
  `authenticated` holds **no** INSERT, UPDATE or DELETE privilege on the tables, so there is no
  request that could skip the validation or the audit.
- **Audit:** `charge_created`, `charge_updated` (only when something changed) and
  `charge_cancelled` go to `audit_log`, with the actor, the student as target, and the full charge
  and schedule (before and after for an update) as details. The helpers live in the `private`
  schema, out of PostgREST's reach.

### 7. No payment allocation (yet)

A payment is **not** tied to an installment, and the model never assumes one installment equals
one payment. The student page shows, per installment, a "Payé / Restant / Statut" computed each
time from the two ledgers: the enrollment's payments cover its active installments **oldest due
date first** (`fee-model.ts` `balanceOf`). This is a display rule, not stored and not an
allocation. It gives the right enrollment totals whatever the payment pattern, and it does not
pretend a specific payment settled a specific installment.

An allocation table is not needed now: totals per enrollment are exact without it, and nothing yet
consumes per-installment settlement (no receipts or invoices). It becomes necessary when a receipt
must name what it settles, or when a family asks for a specific installment to be marked paid out
of order. The extension is additive: `payment_allocations(payment_id → payments, installment_id →
charge_installments, amount_dzd)`, with a sum check per payment. Neither existing table changes.

### 8. User interface

The fees section sits on the student page (`/dashboard/students/$studentId`), shown to
administrators only. It has the student totals (Total dû, Déjà payé, Restant à payer, En retard),
then one block per enrollment. Each block lists the enrollment's charges with their installment
tables (Échéance, Date d'échéance, Montant, Payé, Restant, Statut; stacked lines on a phone), the
payments received, the next installment, and any amount paid beyond the charges. Payments are still
recorded on the Payments page, which the section links to. The dialog builds monthly installments
from a total, a count and a first due date (an even split with the remainder dinar by dinar), keeps
every row editable, and shows the schedule total against the amount. It is translated in fr, ar
and en, and laid out right to left in Arabic.

## Relation to ADR-004

ADR-004 section 9 said "fee items attached to the formation (default) with an optional group
override; charges generated from registrations". This ADR builds the **charge layer** those
defaults will feed: charges on the enrollment, entered by the administration. Formation fee
templates (and a group override) are a later, additive step. A template would only **pre-fill**
`save_charge` when a student is enrolled, so it changes no table defined here. `groups.price_dzd`
stays legacy and unread by this model. It is removed once templates exist and `my-registrations.ts`
and `student-portal.ts` stop reading it.

## Not built (later phases, no placeholder tables)

**Update 2026-10-06:** formation fee templates with group override and the « Formations & tarifs »
catalogue were then built (`20261006110100`), and discounts, receipts, invoices, balances and
reports followed in [ADR-006](./ADR-006-finance-management.md). Still not built: custom fee
types management, payment allocation, refunds and a student-facing fees screen.


Formation fee templates and the group override; custom fee types management; discounts and grants;
payment allocation; receipts; invoices; refunds; balances and arrears reports; a student-facing
fees screen (RLS already allows a student to read their own charges).

## Consequences

- **Three new tables** (`fee_types`, `charges`, `charge_installments`), two RPCs, three audit actions. No existing table,
  policy or screen changes meaning. Two existing files are adjusted: the Payments page copy now
  points to the student page, and the fixture cleanup removes fixture charges before groups.
- **Deletion:** an enrollment, group or student carrying charges cannot be deleted (23503, shown as
  "in use"), exactly as with payments.
- **Tests:** `scripts/e2e/verify-fees.sql` (66 checks, rolled back),
  `scripts/e2e/verify-fees-ui.mjs` (20 checks), `src/features/school/fee-model.test.ts` (20 tests).
