-- Primary/JHS assessment: school-defined subjects, terms and weighting; append-only score entries; immutable published terminal reports.
CREATE TABLE subjects (
  id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 80), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id), UNIQUE(school_id,name)
);
CREATE TABLE terms (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, academic_year_id uuid NOT NULL,
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 80), start_date date NOT NULL, end_date date NOT NULL CHECK(end_date>start_date),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id), UNIQUE(school_id,academic_year_id,name),
  FOREIGN KEY(school_id,academic_year_id) REFERENCES academic_years(school_id,id)
);
-- Weights and grade bands come from the school's own policy; nothing is assumed by the platform.
CREATE TABLE assessment_policies (
  school_id uuid PRIMARY KEY REFERENCES schools(id),
  ca_weight integer NOT NULL CHECK(ca_weight BETWEEN 0 AND 100), exam_weight integer NOT NULL CHECK(exam_weight BETWEEN 0 AND 100),
  bands jsonb NOT NULL CHECK(jsonb_typeof(bands)='array' AND jsonb_array_length(bands) BETWEEN 1 AND 15),
  source_note text NOT NULL CHECK(length(btrim(source_note)) BETWEEN 3 AND 500),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ca_weight+exam_weight=100), FOREIGN KEY(school_id,updated_by) REFERENCES memberships(school_id,id)
);
CREATE TABLE assessment_score_entries (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, term_id uuid NOT NULL, class_id uuid NOT NULL, subject_id uuid NOT NULL, learner_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('ca','exam')), score numeric(5,2) NOT NULL CHECK(score BETWEEN 0 AND 100),
  recorded_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(school_id,id),
  FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id), FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),
  FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id), FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id),
  FOREIGN KEY(school_id,recorded_by) REFERENCES memberships(school_id,id)
);
CREATE INDEX assessment_entries_lookup ON assessment_score_entries(school_id,term_id,class_id,subject_id,learner_id,kind,created_at DESC);
CREATE TABLE terminal_reports (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, term_id uuid NOT NULL, class_id uuid NOT NULL, learner_id uuid NOT NULL,
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'), published_by uuid NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id), UNIQUE(school_id,term_id,learner_id),
  FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id), FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id), FOREIGN KEY(school_id,published_by) REFERENCES memberships(school_id,id)
);
CREATE FUNCTION block_scores_after_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM terminal_reports r WHERE r.school_id=NEW.school_id AND r.term_id=NEW.term_id AND r.learner_id=NEW.learner_id) THEN
    RAISE EXCEPTION 'Scores are locked once the terminal report is published' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessment_scores_locked BEFORE INSERT ON assessment_score_entries FOR EACH ROW EXECUTE FUNCTION block_scores_after_publication();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subjects','terms','assessment_policies','assessment_score_entries','terminal_reports'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON subjects,terms,assessment_score_entries,terminal_reports TO school_app;
GRANT SELECT,INSERT ON assessment_policies TO school_app;
GRANT UPDATE(ca_weight,exam_weight,bands,source_note,version,updated_by,updated_at) ON assessment_policies TO school_app;
CREATE FUNCTION forbid_history_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE TRIGGER assessment_entries_append_only BEFORE UPDATE OR DELETE ON assessment_score_entries FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER terminal_reports_append_only BEFORE UPDATE OR DELETE ON terminal_reports FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
