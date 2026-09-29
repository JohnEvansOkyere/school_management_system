-- Fees: school-defined fee items, per-learner term invoices, append-only payments with reasoned reversals and sequential receipts.
-- All amounts are integer pesewas (1 GHS = 100 pesewas) so money is never floating point.
CREATE TABLE fee_items (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, term_id uuid NOT NULL, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 80),
  level text CHECK(level IS NULL OR level IN ('Nursery','KG','Primary','JHS')), amount_pesewas bigint NOT NULL CHECK(amount_pesewas BETWEEN 1 AND 100000000000),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id),
  FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id), FOREIGN KEY(school_id,created_by) REFERENCES memberships(school_id,id)
);
CREATE TABLE invoices (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, learner_id uuid NOT NULL, term_id uuid NOT NULL, class_id uuid NOT NULL,
  lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'), total_pesewas bigint NOT NULL CHECK(total_pesewas>0),
  issued_by uuid NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id), UNIQUE(school_id,learner_id,term_id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id), FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id),
  FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id), FOREIGN KEY(school_id,issued_by) REFERENCES memberships(school_id,id)
);
CREATE TABLE receipt_counters (school_id uuid PRIMARY KEY REFERENCES schools(id), next_number integer NOT NULL DEFAULT 1);
CREATE TABLE payments (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, invoice_id uuid NOT NULL, amount_pesewas bigint NOT NULL CHECK(amount_pesewas BETWEEN 1 AND 100000000000),
  method text NOT NULL CHECK(method IN ('cash','mobile_money','bank')), reference text CHECK(reference IS NULL OR length(btrim(reference)) BETWEEN 1 AND 80),
  received_on date NOT NULL, receipt_number integer NOT NULL, recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id), UNIQUE(school_id,receipt_number),
  FOREIGN KEY(school_id,invoice_id) REFERENCES invoices(school_id,id), FOREIGN KEY(school_id,recorded_by) REFERENCES memberships(school_id,id)
);
CREATE TABLE payment_reversals (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, payment_id uuid NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
  reversed_by uuid NOT NULL, reversed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,payment_id),
  FOREIGN KEY(school_id,payment_id) REFERENCES payments(school_id,id), FOREIGN KEY(school_id,reversed_by) REFERENCES memberships(school_id,id)
);
CREATE TRIGGER fee_items_append_only BEFORE UPDATE OR DELETE ON fee_items FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER invoices_append_only BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER payment_reversals_append_only BEFORE UPDATE OR DELETE ON payment_reversals FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_items','invoices','receipt_counters','payments','payment_reversals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON fee_items,invoices,payments,payment_reversals TO school_app;
GRANT SELECT,INSERT ON receipt_counters TO school_app;
GRANT UPDATE(next_number) ON receipt_counters TO school_app;
