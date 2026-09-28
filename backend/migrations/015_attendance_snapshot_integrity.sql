ALTER TABLE attendance_registers ADD COLUMN roster_source text CHECK(roster_source IN ('submission','legacy_marks'));
UPDATE attendance_registers r SET roster_source=CASE
  WHEN EXISTS(SELECT 1 FROM attendance_roster_snapshots s WHERE s.school_id=r.school_id AND s.register_id=r.id) THEN 'submission'
  ELSE 'legacy_marks' END WHERE r.status<>'draft';

-- Older registers retain their saved mark membership, never today's enrolments.
-- Original submission-time names were not stored; legacy provenance stays visible.
INSERT INTO attendance_roster_snapshots(id,school_id,register_id,learner_id,enrolment_id,full_name,admission_number)
SELECT m.id,m.school_id,m.register_id,m.learner_id,m.enrolment_id,l.full_name,l.admission_number
FROM attendance_marks m JOIN attendance_registers r ON r.school_id=m.school_id AND r.id=m.register_id
JOIN learners l ON l.school_id=m.school_id AND l.id=m.learner_id
WHERE r.roster_source='legacy_marks';
ALTER TABLE attendance_registers ADD CONSTRAINT attendance_roster_capture_state
  CHECK((status='draft')=(roster_source IS NULL));

CREATE FUNCTION preserve_attendance_roster() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE register_row public.attendance_registers;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'Captured attendance roster is immutable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO register_row FROM public.attendance_registers
    WHERE school_id=NEW.school_id AND id=NEW.register_id FOR UPDATE;
  IF NOT FOUND OR register_row.status<>'draft' THEN
    RAISE EXCEPTION 'Roster capture requires a draft register' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.enrolments WHERE school_id=NEW.school_id AND id=NEW.enrolment_id
    AND learner_id=NEW.learner_id AND class_id=register_row.class_id AND superseded_at IS NULL
    AND start_date<=register_row.day AND (end_date IS NULL OR end_date>register_row.day)) THEN
    RAISE EXCEPTION 'Roster capture must reference the eligible enrolment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION preserve_attendance_roster() FROM PUBLIC;
CREATE TRIGGER attendance_roster_immutable BEFORE INSERT OR UPDATE OR DELETE ON attendance_roster_snapshots
  FOR EACH ROW EXECUTE FUNCTION preserve_attendance_roster();

CREATE FUNCTION preserve_attendance_roster_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status<>'draft' AND NEW.roster_source IS DISTINCT FROM OLD.roster_source THEN
    RAISE EXCEPTION 'Attendance roster provenance is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION preserve_attendance_roster_source() FROM PUBLIC;
CREATE TRIGGER attendance_roster_source_immutable BEFORE UPDATE ON attendance_registers
  FOR EACH ROW EXECUTE FUNCTION preserve_attendance_roster_source();
