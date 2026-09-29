-- Corrections after publication: the head reopens one learner's report with a reason, scores may then change,
-- and a new revision is published. Earlier revisions stay; guardians see the latest.
ALTER TABLE terminal_reports ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0), ADD COLUMN supersedes_id uuid, ADD COLUMN correction_reason text;
ALTER TABLE terminal_reports DROP CONSTRAINT terminal_reports_school_id_term_id_learner_id_key;
ALTER TABLE terminal_reports ADD CONSTRAINT terminal_reports_revision_key UNIQUE(school_id,term_id,learner_id,revision);
ALTER TABLE terminal_reports ADD CONSTRAINT terminal_reports_supersedes_fk FOREIGN KEY(school_id,supersedes_id) REFERENCES terminal_reports(school_id,id);
ALTER TABLE terminal_reports ADD CONSTRAINT terminal_reports_correction_shape CHECK((revision=1 AND supersedes_id IS NULL AND correction_reason IS NULL) OR (revision>1 AND supersedes_id IS NOT NULL AND length(btrim(correction_reason)) BETWEEN 3 AND 500));
CREATE TABLE assessment_reopenings (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, term_id uuid NOT NULL, learner_id uuid NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
  opened_by uuid NOT NULL, opened_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(school_id,id),
  FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id), FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id), FOREIGN KEY(school_id,opened_by) REFERENCES memberships(school_id,id)
);
CREATE INDEX assessment_reopenings_lookup ON assessment_reopenings(school_id,term_id,learner_id,opened_at DESC);
CREATE TRIGGER assessment_reopenings_append_only BEFORE UPDATE OR DELETE ON assessment_reopenings FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
ALTER TABLE assessment_reopenings ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_reopenings FORCE ROW LEVEL SECURITY;
CREATE POLICY assessment_reopenings_school_context ON assessment_reopenings USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true));
GRANT SELECT,INSERT ON assessment_reopenings TO school_app;
-- Scores stay locked after publication unless a reopening is newer than the latest published revision.
CREATE OR REPLACE FUNCTION block_scores_after_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE last_published timestamptz;
BEGIN
  SELECT max(r.published_at) INTO last_published FROM terminal_reports r WHERE r.school_id=NEW.school_id AND r.term_id=NEW.term_id AND r.learner_id=NEW.learner_id;
  IF last_published IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assessment_reopenings o WHERE o.school_id=NEW.school_id AND o.term_id=NEW.term_id AND o.learner_id=NEW.learner_id AND o.opened_at>last_published) THEN
    RAISE EXCEPTION 'Scores are locked once the terminal report is published' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
