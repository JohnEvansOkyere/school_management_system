CREATE OR REPLACE FUNCTION preserve_closed_enrolment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.superseded_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Superseded enrolment history is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.superseded_at IS NOT NULL AND (NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.end_reason IS DISTINCT FROM OLD.end_reason) THEN
    RAISE EXCEPTION 'Supersession must preserve original dates and reason' USING ERRCODE='23514';
  END IF;
  IF OLD.end_date IS NOT NULL AND (NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.end_reason IS DISTINCT FROM OLD.end_reason) THEN
    RAISE EXCEPTION 'Closed enrolment history is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
