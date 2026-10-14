-- ==================================================================
-- Student fee payments
--
-- WHY THIS MIGRATION EXISTS
--
-- A centre already knows what a place costs -- `groups.price_dzd` has been on the schema
-- since the first migration -- and it already knows who holds a place, because an approved
-- `registrations` row is exactly that. What it has never been able to record is whether the
-- family paid. The sidebar has carried a "Paiements" entry, translated into all three
-- locales, behind a `comingSoon` flag for as long as the dictionary has existed. This is the
-- table behind it.
--
-- WHY IT HANGS OFF `registrations`, NOT `students`
--
-- A family pays for a PLACE IN A GROUP, not for a child in the abstract: the same student
-- enrolled in two subjects owes two fees, and a payment that pointed only at the student
-- could not say which. `registration_id` also carries the group, and the group carries the
-- price, so what is owed is derivable without storing it twice -- and a later change to a
-- group's price does not silently rewrite the history of what was already paid.
--
-- WHY THE AMOUNT IS STORED AND THE BALANCE IS NOT
--
-- The amount handed over is a fact and is recorded. The balance is arithmetic over the
-- price and the payments, so it is computed where it is read. Storing it would create two
-- places that can disagree, and the one that is wrong is always the cached one.
--
-- INTEGERS, IN CENTIMES OF NOTHING
--
-- `price_dzd` is already `int`, and the dinar is not used with subunits here, so payments
-- match it: `int`, whole dinars. No floating point touches money anywhere in this schema.
-- ==================================================================

-- How the money arrived. Text with a check rather than an enum: a centre may start taking
-- a method this list does not have, and adding a value to an enum in Postgres cannot be
-- done inside a transaction that also uses it. The check is trivially widened later.
CREATE TABLE IF NOT EXISTS public.payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.registrations (id) ON DELETE CASCADE,
  -- Whole dinars, and strictly positive: a refund is not a negative payment, it is a
  -- different event with different meaning, and modelling it as a sign would make every
  -- sum ambiguous. If refunds are needed they get their own column or their own row type.
  amount_dzd      int NOT NULL CHECK (amount_dzd > 0),
  -- The day the money changed hands, which is not always the day it was typed in.
  paid_on         date NOT NULL DEFAULT current_date,
  method          text NOT NULL DEFAULT 'cash'
                    CHECK (method IN ('cash', 'transfer', 'cheque', 'other')),
  note            text CHECK (note IS NULL OR length(note) <= 500),
  -- Who recorded it. ON DELETE SET NULL so removing a staff account never destroys the
  -- financial record they entered -- the same reasoning `groups.teacher_id` uses.
  -- Defaulted, not left to the caller. A payment whose recorder is unknown is a hole in
  -- the audit trail, and relying on every client to remember to send it means the first one
  -- that forgets writes an anonymous financial record. The insert policy still refuses a
  -- value that is not the caller, so this cannot be used to attribute money to a colleague.
  recorded_by     uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Every read is "the payments of this registration", so this is the index that matters.
CREATE INDEX IF NOT EXISTS idx_payments_registration ON public.payments (registration_id);
-- Ordering a centre's ledger by day.
CREATE INDEX IF NOT EXISTS idx_payments_paid_on ON public.payments (paid_on DESC);

DROP TRIGGER IF EXISTS t_payments_touch ON public.payments;
CREATE TRIGGER t_payments_touch
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Table privileges, which RLS does NOT imply.
--
-- A policy filters the rows a role may see; it cannot grant the role access to the table in
-- the first place. Without these the whole feature answers 42501 -- "permission denied for
-- table payments" -- however correct the policies are. Every other table here carries the
-- same pair, and this one was written without them until an authorization test said so.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;

-- ------------------------------------------------------------------
-- RLS. New policies on a new table; nothing existing is altered.
--
-- Money is administrative. A teacher can see who is enrolled in their group and can mark
-- attendance, but what a family paid is not theirs to read -- so teachers are deliberately
-- absent from every policy below rather than being granted a read they do not need.
-- ------------------------------------------------------------------

-- A student sees their own payments; an administrator sees all of them.
CREATE POLICY "payments read" ON public.payments
  FOR SELECT TO authenticated
  USING (
    private.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.registrations r
       WHERE r.id = payments.registration_id
         AND r.student_id = auth.uid()
    )
  );

-- Only an administrator records money, and `recorded_by` cannot be attributed to someone
-- else: the row must name the person who is actually inserting it.
CREATE POLICY "payments insert" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin() AND (recorded_by IS NULL OR recorded_by = auth.uid()));

CREATE POLICY "payments update" ON public.payments
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

CREATE POLICY "payments delete" ON public.payments
  FOR DELETE TO authenticated
  USING (private.is_admin());

COMMENT ON TABLE public.payments IS
  'Fees received against a registration. Amounts are whole dinars and strictly positive; what is owed is derived from the group price rather than stored. Administrators write, students read their own, teachers see nothing.';
