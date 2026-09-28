ALTER TABLE enrolments ADD COLUMN superseded_at timestamptz;
ALTER TABLE enrolments ADD COLUMN supersession_reason text;
ALTER TABLE enrolments ADD CHECK ((superseded_at IS NULL)=(supersession_reason IS NULL));
DO $$ DECLARE constraint_name text; BEGIN
  SELECT conname INTO constraint_name FROM pg_constraint WHERE conrelid='enrolments'::regclass AND contype='x';
  EXECUTE format('ALTER TABLE enrolments DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE enrolments ADD CONSTRAINT active_enrolments_do_not_overlap
  EXCLUDE USING gist(school_id WITH =,learner_id WITH =,daterange(start_date,end_date,'[)') WITH &&)
  WHERE (superseded_at IS NULL);
CREATE OR REPLACE FUNCTION preserve_closed_enrolment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.superseded_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Superseded enrolment history is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.end_date IS NOT NULL AND (NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.end_reason IS DISTINCT FROM OLD.end_reason) THEN
    RAISE EXCEPTION 'Closed enrolment history is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
GRANT UPDATE(superseded_at,supersession_reason) ON enrolments TO school_app;
