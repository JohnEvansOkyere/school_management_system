CREATE TABLE learner_import_batches (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,class_id uuid NOT NULL,start_date date NOT NULL,
  source_name text NOT NULL,source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'staged' CHECK(status IN ('staged','committed')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 200),
  created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,approved_at timestamptz,approval_reason text,committed_at timestamptz,
  UNIQUE(school_id,id),FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),
  FOREIGN KEY(school_id,created_by) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,approved_by) REFERENCES memberships(school_id,id),
  CHECK((status='staged' AND approved_by IS NULL AND approved_at IS NULL AND approval_reason IS NULL AND committed_at IS NULL) OR
    (status='committed' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND length(btrim(approval_reason))>=3 AND committed_at IS NOT NULL))
);
CREATE TABLE learner_import_rows (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,batch_id uuid NOT NULL,row_number integer NOT NULL CHECK(row_number BETWEEN 2 AND 201),
  input jsonb NOT NULL,validation jsonb NOT NULL,learner_id uuid,
  duplicate_review_reason text CHECK(duplicate_review_reason IS NULL OR length(btrim(duplicate_review_reason))>=3),
  UNIQUE(school_id,batch_id,row_number),FOREIGN KEY(school_id,batch_id) REFERENCES learner_import_batches(school_id,id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id)
);
CREATE INDEX learner_import_school_history ON learner_import_batches(school_id,created_at DESC,id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['learner_import_batches','learner_import_rows'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY import_school_context ON %I USING(school_id::text=current_setting(''app.school_id'',true)) WITH CHECK(school_id::text=current_setting(''app.school_id'',true))',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON learner_import_batches,learner_import_rows TO school_app;
GRANT UPDATE(status,version,approved_by,approved_at,approval_reason,committed_at) ON learner_import_batches TO school_app;
GRANT UPDATE(validation,learner_id,duplicate_review_reason) ON learner_import_rows TO school_app;

CREATE FUNCTION preserve_learner_import() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE batch_row public.learner_import_batches;
BEGIN
  IF TG_TABLE_NAME='learner_import_batches' THEN
    IF OLD.status='committed' OR ROW(NEW.id,NEW.school_id,NEW.class_id,NEW.start_date,NEW.source_name,NEW.source_digest,NEW.row_count,NEW.created_by,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.class_id,OLD.start_date,OLD.source_name,OLD.source_digest,OLD.row_count,OLD.created_by,OLD.created_at) THEN
      RAISE EXCEPTION 'Import source and committed approval are immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    IF TG_OP='INSERT' THEN
      SELECT * INTO batch_row FROM public.learner_import_batches WHERE school_id=NEW.school_id AND id=NEW.batch_id FOR UPDATE;
      IF NOT FOUND OR batch_row.status<>'staged' OR NEW.learner_id IS NOT NULL OR NEW.duplicate_review_reason IS NOT NULL
        OR (SELECT count(*) FROM public.learner_import_rows WHERE school_id=NEW.school_id AND batch_id=NEW.batch_id)>=batch_row.row_count THEN
        RAISE EXCEPTION 'Import rows must belong to the initial staged source' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
    IF ROW(NEW.id,NEW.school_id,NEW.batch_id,NEW.row_number,NEW.input) IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.batch_id,OLD.row_number,OLD.input)
      OR OLD.learner_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.learner_import_batches WHERE school_id=OLD.school_id AND id=OLD.batch_id AND status='staged') THEN
      RAISE EXCEPTION 'Import source and committed outcomes are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION preserve_learner_import() FROM PUBLIC;
CREATE TRIGGER learner_import_batch_immutable BEFORE UPDATE ON learner_import_batches FOR EACH ROW EXECUTE FUNCTION preserve_learner_import();
CREATE TRIGGER learner_import_row_immutable BEFORE INSERT OR UPDATE ON learner_import_rows FOR EACH ROW EXECUTE FUNCTION preserve_learner_import();
