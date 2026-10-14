# ADR-006 — Finance Management: Balances, Discounts, Receipts, Invoices, Reports

**Status:** Accepted — implementation 2026-10-06 (local only, branch
`product-completion/pre-inscriptions`, not merged).
**Date:** 2026-10-06
**Builds on:** [ADR-005](./ADR-005-fees-and-installments.md) (charges, installments, fee templates),
payments (`20260930100100_payment_management.sql`).

## Context

The sidebar section « Gestion financière » had Paiements and « Formations & tarifs » live, and five
roadmap entries: Factures, Reçus, Soldes & impayés, Remises & bourses, Rapports. The data they
need already exists: what is owed (`charges`, `charge_installments`, created by hand or from fee
templates), and what is received (`payments`). This ADR adds the five pages without changing
either ledger.

## The rule that holds everything together

Four separate records, never merged:

| Record | Question | Table |
|---|---|---|
| Charge | What is owed? | `charges` + `charge_installments` |
| Discount | What is waived? | `charge_discounts` (new) |
| Payment | What was received? | `payments` |
| Document | What was handed to the family? | `receipts`, `invoices` (new) |

**Balance = active charges − active discounts − payments**, per enrollment, always derived and
never stored. A discount never edits a charge, a payment never edits a charge, and a document
never edits any of them: documents are snapshots.

## 1. Soldes & impayés (`/dashboard/balances`)

- **Data:** derived only, with no new table. It uses one read of active charges with their
  installments and discounts, plus one read of payments, then `fee-model.ts` `balanceOf`,
  extended with discounts. Rows are per enrollment, grouped by student.
- **Display and filters:** each row shows what is due, discounted, paid and left, the overdue
  amount and the next installment. Filters cover overdue only, left to pay, formation and search.
  The page has a CSV export and links to the student page.
- **Coverage:** for display, discounts and payments cover installments oldest due date first, the
  same rule as ADR-005. Nothing is allocated.

## 2. Remises & bourses (`/dashboard/discounts`)

- **Catalogue:** `discounts(id, name, kind percent|amount, value, fee_type NULL = any, status)`, for
  example « Fratrie −10 % », « Bourse 100 % » or « Remise fidélité −2 000 DZD ».
- **Grant:** `charge_discounts(id, charge_id, discount_id NULL, label, amount_dzd > 0, reason,
  status active|cancelled, cancelled_*)`. The amount is computed and frozen when the discount is
  granted: a percentage of the charge, never more than what the charge still allows. Editing the
  catalogue later changes no grant.
- **Writes:** `grant_discount` and `cancel_discount` (SECURITY DEFINER, admin check, audited).
  The total of active discounts on a charge never exceeds the charge (checked in the function and
  by a deferred trigger).
- **Where it is used:** the page manages the catalogue and lists every grant. A grant is made from
  the student page, on a fee.

## 3. Reçus (`/dashboard/receipts`)

- **One receipt per payment, issued automatically** by a trigger on `payments` INSERT, numbered
  `REC-<year>-<6 digits>` from `document_sequences(kind, year, last_value)`. The counter is locked
  row-wise, so there are no gaps under concurrency within the transaction and numbers are never
  reused.
- **Snapshot:** the receipt stores what it says (student, formation and group, amount, date,
  method, reference). Editing a payment's amount, date or method **voids** its receipt and issues
  a new number; deleting a payment voids its receipt (`payment_id` becomes NULL, the snapshot
  stays). A voided receipt stays listed.
- **Existing payments** receive a receipt when the migration runs, numbered in payment order. They
  are not modified.
- The page lists receipts with search, period and voided filters, and has a printable view
  (`/dashboard/receipts/$receiptId`, browser print; the school's name, logo, address and phone).

## 4. Factures (`/dashboard/invoices`)

- **On demand, per enrollment:** `issue_invoice(registration)` snapshots the enrollment's active
  charges (lines), active discounts, payments received and balance at that moment. It is numbered
  `FAC-<year>-<6 digits>` from the same sequence table.
- **Lifecycle:** an invoice is a document, not a ledger. It is never edited; `void_invoice` (with a
  reason) cancels it and a new one can be issued. Nothing in charges or payments changes.
- **Billing identity:** optional legal identifiers on `center_settings` (`legal_name`, `nif`,
  `nis`, `rc`, `tax_article`), edited on the Factures page by administrators and printed when set.
- The page lists invoices with filters and has an "issue an invoice" picker (student, then
  enrollment) and a printable view.

## 5. Rapports (`/dashboard/reports`)

- **Views:** read-only, `security_invoker`, so the reader's RLS applies (admins only in practice):
  - `finance_monthly`: payments per month and method;
  - `finance_by_program`: payments, charges and discounts per formation.
- **Ageing of what is overdue:** 0–30, 31–60, 61–90 and over 90 days, derived client-side from the
  same balance data as Soldes & impayés.
- **Page:** period selector, figure cards (received, charged, discounted, left, overdue), the tables
  above, and CSV export per table.

## Security (all five)

- Every new table has RLS enabled. Administrators read. Clients have no INSERT, UPDATE or DELETE
  privilege. Writes go only through SECURITY DEFINER functions that check the administrator
  first, pin `search_path`, are not executable by `anon`, and write `audit_log`. The new audit
  actions are `discount_*`, `receipt_*` and `invoice_*`.
- Teachers see nothing financial. Students can read their own receipts and invoices (RLS ready);
  no student screen is built.

## Not built

Online payment, e-invoicing, accounting export formats, automatic dunning or SMS reminders, refunds
(a separate record will be needed; never negative payments), and payment allocation.

## Consequences

- **Migrations:** one for the audit enum values, then one per module (discounts, receipts,
  invoices, reports). `payments`, `charges` and `charge_installments` keep their columns and
  rules; `payments` gains only the receipt triggers.
- **Code:** `balanceOf` gains an optional `discounts` argument, so existing callers are unchanged,
  and the student page shows discounts.
- **Sidebar:** the five entries become live, so « Bientôt » disappears from Gestion financière.
