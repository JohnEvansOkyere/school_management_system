CREATE TABLE early_years_reports (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,learner_id uuid NOT NULL,enrolment_id uuid NOT NULL,class_id uuid NOT NULL,
  level text NOT NULL CHECK(level IN ('Nursery','KG')),period_start date NOT NULL,period_end date NOT NULL CHECK(period_end>=period_start),
  current_revision_id uuid,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(school_id,id),
  UNIQUE(school_id,learner_id,enrolment_id,period_start,period_end),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id),FOREIGN KEY(school_id,enrolment_id) REFERENCES enrolments(school_id,id),
  FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id)
);
CREATE TABLE early_years_report_revisions (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,report_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),version integer NOT NULL DEFAULT 1 CHECK(version>0),
  supersedes_id uuid,correction_reason text,author_membership_id uuid NOT NULL,author_display_name text NOT NULL,
  strengths text NOT NULL CHECK(length(btrim(strengths)) BETWEEN 3 AND 2000),next_steps text NOT NULL CHECK(length(btrim(next_steps)) BETWEEN 3 AND 2000),teacher_note text CHECK(teacher_note IS NULL OR length(btrim(teacher_note))<=2000),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),template_version text NOT NULL CHECK(length(btrim(template_version)) BETWEEN 1 AND 40),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','returned','approved','published')),
  submitted_by uuid,submitted_at timestamptz,returned_by uuid,returned_at timestamptz,return_reason text,approved_by uuid,approved_at timestamptz,published_by uuid,published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(school_id,id),UNIQUE(school_id,report_id,id),UNIQUE(school_id,report_id,revision),UNIQUE(school_id,supersedes_id),
  FOREIGN KEY(school_id,report_id) REFERENCES early_years_reports(school_id,id),FOREIGN KEY(school_id,supersedes_id) REFERENCES early_years_report_revisions(school_id,id),
  FOREIGN KEY(school_id,author_membership_id) REFERENCES memberships(school_id,id),FOREIGN KEY(school_id,submitted_by) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,returned_by) REFERENCES memberships(school_id,id),FOREIGN KEY(school_id,approved_by) REFERENCES memberships(school_id,id),FOREIGN KEY(school_id,published_by) REFERENCES memberships(school_id,id),
  CHECK((status='draft' AND submitted_by IS NULL AND submitted_at IS NULL AND returned_by IS NULL AND returned_at IS NULL AND return_reason IS NULL AND approved_by IS NULL AND approved_at IS NULL AND published_by IS NULL AND published_at IS NULL) OR
    (status='submitted' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND returned_by IS NULL AND returned_at IS NULL AND return_reason IS NULL AND approved_by IS NULL AND approved_at IS NULL AND published_by IS NULL AND published_at IS NULL) OR
    (status='returned' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND returned_by IS NOT NULL AND returned_at IS NOT NULL AND return_reason IS NOT NULL AND ((approved_by IS NULL AND approved_at IS NULL) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)) AND published_by IS NULL AND published_at IS NULL) OR
    (status='approved' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND returned_by IS NULL AND returned_at IS NULL AND return_reason IS NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND published_by IS NULL AND published_at IS NULL) OR
    (status='published' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND returned_by IS NULL AND returned_at IS NULL AND return_reason IS NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND published_by IS NOT NULL AND published_at IS NOT NULL)),
  CHECK((supersedes_id IS NULL AND correction_reason IS NULL) OR (supersedes_id IS NOT NULL AND correction_reason IS NOT NULL AND length(btrim(correction_reason)) BETWEEN 3 AND 500))
);
ALTER TABLE early_years_reports ADD CONSTRAINT early_years_report_current_revision FOREIGN KEY(school_id,current_revision_id) REFERENCES early_years_report_revisions(school_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION guard_early_years_report_pointer() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE candidate early_years_report_revisions%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.current_revision_id IS NOT NULL THEN RAISE EXCEPTION 'Create the report before its first revision' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.school_id,NEW.learner_id,NEW.enrolment_id,NEW.class_id,NEW.level,NEW.period_start,NEW.period_end,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.learner_id,OLD.enrolment_id,OLD.class_id,OLD.level,OLD.period_start,OLD.period_end,OLD.created_at) THEN
    RAISE EXCEPTION 'Report identity and period are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.current_revision_id IS DISTINCT FROM OLD.current_revision_id THEN
    IF NEW.current_revision_id IS NULL THEN RAISE EXCEPTION 'Current report revision cannot be cleared' USING ERRCODE='23514'; END IF;
    SELECT * INTO candidate FROM early_years_report_revisions WHERE school_id=NEW.school_id AND id=NEW.current_revision_id;
    IF NOT FOUND OR candidate.report_id<>NEW.id OR
      (OLD.current_revision_id IS NULL AND (candidate.revision<>1 OR candidate.supersedes_id IS NOT NULL)) OR
      (OLD.current_revision_id IS NOT NULL AND candidate.supersedes_id IS DISTINCT FROM OLD.current_revision_id) THEN
      RAISE EXCEPTION 'Current report revision must extend this report history' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_early_years_report_pointer() FROM PUBLIC;
CREATE TRIGGER early_years_report_pointer_guard BEFORE INSERT OR UPDATE ON early_years_reports FOR EACH ROW EXECUTE FUNCTION guard_early_years_report_pointer();
CREATE TABLE early_years_report_events (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,report_id uuid NOT NULL,revision_id uuid NOT NULL,actor_membership_id uuid NOT NULL,actor_display_name text NOT NULL,
  action text NOT NULL CHECK(action IN ('drafted','draft_updated','corrected','submitted','returned','approved','published')),reason text,input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),FOREIGN KEY(school_id,report_id) REFERENCES early_years_reports(school_id,id),FOREIGN KEY(school_id,report_id,revision_id) REFERENCES early_years_report_revisions(school_id,report_id,id),
  FOREIGN KEY(school_id,actor_membership_id) REFERENCES memberships(school_id,id),CHECK(reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 500)
);
CREATE INDEX early_years_report_history ON early_years_reports(school_id,learner_id,period_start DESC,created_at DESC,id);
CREATE INDEX early_years_report_review_queue ON early_years_report_revisions(school_id,status,created_at DESC,id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['early_years_reports','early_years_report_revisions','early_years_report_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY early_years_report_school ON %I USING(school_id::text=current_setting(''app.school_id'',true)) WITH CHECK(school_id::text=current_setting(''app.school_id'',true))',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE(current_revision_id) ON early_years_reports TO school_app;
GRANT SELECT,INSERT ON early_years_report_events TO school_app;
GRANT SELECT,INSERT ON early_years_report_revisions TO school_app;
GRANT UPDATE(version,strengths,next_steps,teacher_note,snapshot,input_digest,status,submitted_by,submitted_at,returned_by,returned_at,return_reason,approved_by,approved_at,published_by,published_at) ON early_years_report_revisions TO school_app;
CREATE FUNCTION guard_early_years_report_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE prior early_years_report_revisions%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'draft' OR NEW.version<>1 OR NEW.submitted_by IS NOT NULL OR NEW.returned_by IS NOT NULL OR NEW.approved_by IS NOT NULL OR NEW.published_by IS NOT NULL THEN RAISE EXCEPTION 'Reports must start as draft revisions' USING ERRCODE='23514'; END IF;
    IF NEW.supersedes_id IS NULL THEN
      IF NEW.revision<>1 THEN RAISE EXCEPTION 'First report revision must be revision one' USING ERRCODE='23514'; END IF;
    ELSE
      SELECT * INTO prior FROM early_years_report_revisions WHERE school_id=NEW.school_id AND report_id=NEW.report_id AND id=NEW.supersedes_id FOR SHARE;
      IF NOT FOUND OR prior.status NOT IN ('returned','published') OR NEW.revision<>prior.revision+1 THEN RAISE EXCEPTION 'New revision must extend a returned or published report' USING ERRCODE='23514'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.school_id,NEW.report_id,NEW.revision,NEW.supersedes_id,NEW.correction_reason,NEW.author_membership_id,NEW.author_display_name,NEW.template_version,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.report_id,OLD.revision,OLD.supersedes_id,OLD.correction_reason,OLD.author_membership_id,OLD.author_display_name,OLD.template_version,OLD.created_at)
      OR NEW.version<>OLD.version+1 OR OLD.status IN ('returned','published') THEN
    RAISE EXCEPTION 'Report revision history is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='draft' AND NEW.status='draft' THEN
    IF ROW(NEW.submitted_by,NEW.submitted_at,NEW.returned_by,NEW.returned_at,NEW.return_reason,NEW.approved_by,NEW.approved_at,NEW.published_by,NEW.published_at)
      IS DISTINCT FROM ROW(OLD.submitted_by,OLD.submitted_at,OLD.returned_by,OLD.returned_at,OLD.return_reason,OLD.approved_by,OLD.approved_at,OLD.published_by,OLD.published_at) THEN RAISE EXCEPTION 'Draft review state cannot be changed' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status='draft' AND NEW.status='submitted' THEN
    IF ROW(NEW.strengths,NEW.next_steps,NEW.teacher_note,NEW.snapshot,NEW.input_digest) IS DISTINCT FROM ROW(OLD.strengths,OLD.next_steps,OLD.teacher_note,OLD.snapshot,OLD.input_digest) OR NEW.submitted_by IS NULL OR NEW.submitted_at IS NULL OR NEW.returned_by IS NOT NULL OR NEW.approved_by IS NOT NULL OR NEW.published_by IS NOT NULL THEN RAISE EXCEPTION 'Invalid report submission' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status='submitted' AND NEW.status='returned' THEN
    IF ROW(NEW.strengths,NEW.next_steps,NEW.teacher_note,NEW.snapshot,NEW.input_digest,NEW.submitted_by,NEW.submitted_at) IS DISTINCT FROM ROW(OLD.strengths,OLD.next_steps,OLD.teacher_note,OLD.snapshot,OLD.input_digest,OLD.submitted_by,OLD.submitted_at) OR NEW.returned_by IS NULL OR NEW.returned_at IS NULL OR NEW.return_reason IS NULL OR NEW.approved_by IS NOT NULL OR NEW.published_by IS NOT NULL THEN RAISE EXCEPTION 'Invalid report return' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status='submitted' AND NEW.status='approved' THEN
    IF ROW(NEW.strengths,NEW.next_steps,NEW.teacher_note,NEW.snapshot,NEW.input_digest,NEW.submitted_by,NEW.submitted_at) IS DISTINCT FROM ROW(OLD.strengths,OLD.next_steps,OLD.teacher_note,OLD.snapshot,OLD.input_digest,OLD.submitted_by,OLD.submitted_at) OR NEW.returned_by IS NOT NULL OR NEW.approved_by IS NULL OR NEW.approved_at IS NULL OR NEW.published_by IS NOT NULL THEN RAISE EXCEPTION 'Invalid report approval' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status='approved' AND NEW.status='returned' THEN
    IF ROW(NEW.strengths,NEW.next_steps,NEW.teacher_note,NEW.snapshot,NEW.input_digest,NEW.submitted_by,NEW.submitted_at,NEW.approved_by,NEW.approved_at) IS DISTINCT FROM ROW(OLD.strengths,OLD.next_steps,OLD.teacher_note,OLD.snapshot,OLD.input_digest,OLD.submitted_by,OLD.submitted_at,OLD.approved_by,OLD.approved_at) OR NEW.returned_by IS NULL OR NEW.returned_at IS NULL OR NEW.return_reason IS NULL OR NEW.published_by IS NOT NULL THEN RAISE EXCEPTION 'Invalid report approval reset' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status='approved' AND NEW.status='published' THEN
    IF ROW(NEW.strengths,NEW.next_steps,NEW.teacher_note,NEW.snapshot,NEW.input_digest,NEW.submitted_by,NEW.submitted_at,NEW.approved_by,NEW.approved_at) IS DISTINCT FROM ROW(OLD.strengths,OLD.next_steps,OLD.teacher_note,OLD.snapshot,OLD.input_digest,OLD.submitted_by,OLD.submitted_at,OLD.approved_by,OLD.approved_at) OR NEW.published_by IS NULL OR NEW.published_at IS NULL THEN RAISE EXCEPTION 'Invalid report publication' USING ERRCODE='23514'; END IF;
  ELSE
    RAISE EXCEPTION 'Invalid report revision transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_early_years_report_revision() FROM PUBLIC;
CREATE TRIGGER early_years_report_revision_guard BEFORE INSERT OR UPDATE ON early_years_report_revisions FOR EACH ROW EXECUTE FUNCTION guard_early_years_report_revision();
CREATE FUNCTION guard_early_years_report_events() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN RAISE EXCEPTION 'Report event history is immutable' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION guard_early_years_report_events() FROM PUBLIC;
CREATE TRIGGER early_years_report_events_immutable BEFORE UPDATE OR DELETE ON early_years_report_events FOR EACH ROW EXECUTE FUNCTION guard_early_years_report_events();
