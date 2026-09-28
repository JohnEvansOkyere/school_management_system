CREATE TABLE early_years_policies (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,level text NOT NULL CHECK(level IN ('Nursery','KG')),
  title text NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 120),source_kind text NOT NULL CHECK(source_kind IN ('school_local','official_reference_supplied_by_school')),source_issuer text NOT NULL CHECK(length(btrim(source_issuer)) BETWEEN 3 AND 120),
  source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 3 AND 500),source_version text NOT NULL CHECK(length(btrim(source_version)) BETWEEN 1 AND 80),
  effective_start date NOT NULL,effective_end date,CHECK(effective_end IS NULL OR effective_end>effective_start),
  specialist_name text,specialist_qualification text,specialist_review_reference text,specialist_reviewed_on date,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','retired')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by uuid NOT NULL,approved_by uuid,approved_at timestamptz,retired_by uuid,retired_at timestamptz,retirement_reason text,
  UNIQUE(school_id,id),FOREIGN KEY(school_id) REFERENCES schools(id),FOREIGN KEY(school_id,created_by) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,approved_by) REFERENCES memberships(school_id,id),FOREIGN KEY(school_id,retired_by) REFERENCES memberships(school_id,id),
  CHECK(level<>'Nursery' OR (specialist_name IS NOT NULL AND length(btrim(specialist_name)) BETWEEN 3 AND 120 AND specialist_qualification IS NOT NULL AND length(btrim(specialist_qualification)) BETWEEN 3 AND 300 AND specialist_review_reference IS NOT NULL AND length(btrim(specialist_review_reference)) BETWEEN 3 AND 500 AND specialist_reviewed_on IS NOT NULL)),
  CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL AND retired_by IS NULL AND retired_at IS NULL AND retirement_reason IS NULL) OR
    (status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND retired_by IS NULL AND retired_at IS NULL AND retirement_reason IS NULL) OR
    (status='retired' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND retired_by IS NOT NULL AND retired_at IS NOT NULL AND retirement_reason IS NOT NULL AND length(btrim(retirement_reason))>=3))
);
CREATE TABLE early_years_indicators (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,policy_id uuid NOT NULL,code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 40),
  title text NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 160),learning_area text NOT NULL CHECK(length(btrim(learning_area)) BETWEEN 2 AND 120),
  strand text NOT NULL CHECK(length(btrim(strand)) BETWEEN 2 AND 160),sub_strand text NOT NULL CHECK(length(btrim(sub_strand)) BETWEEN 2 AND 160),
  descriptors jsonb NOT NULL CHECK(jsonb_typeof(descriptors)='array' AND jsonb_array_length(descriptors) BETWEEN 1 AND 12),
  UNIQUE(school_id,id),UNIQUE(school_id,policy_id,code),FOREIGN KEY(school_id,policy_id) REFERENCES early_years_policies(school_id,id)
);
CREATE TABLE early_years_observations (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,learner_id uuid NOT NULL,class_id uuid NOT NULL,enrolment_id uuid NOT NULL,
  level text NOT NULL CHECK(level IN ('Nursery','KG')),observed_on date NOT NULL,educator_membership_id uuid NOT NULL,educator_display_name text NOT NULL,recorded_by_membership_id uuid NOT NULL,
  policy_id uuid NOT NULL,policy_version integer NOT NULL,policy_snapshot jsonb NOT NULL CHECK(jsonb_typeof(policy_snapshot)='object'),
  entries jsonb NOT NULL CHECK(jsonb_typeof(entries)='array' AND jsonb_array_length(entries) BETWEEN 1 AND 40),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),supersedes_id uuid,correction_reason text,created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),UNIQUE(school_id,supersedes_id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id),FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),
  FOREIGN KEY(school_id,enrolment_id) REFERENCES enrolments(school_id,id),FOREIGN KEY(school_id,educator_membership_id) REFERENCES memberships(school_id,id),FOREIGN KEY(school_id,recorded_by_membership_id) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,policy_id) REFERENCES early_years_policies(school_id,id),FOREIGN KEY(school_id,supersedes_id) REFERENCES early_years_observations(school_id,id),
  CHECK((supersedes_id IS NULL AND correction_reason IS NULL) OR (supersedes_id IS NOT NULL AND correction_reason IS NOT NULL AND length(btrim(correction_reason)) BETWEEN 3 AND 500))
);
CREATE INDEX early_years_policy_lookup ON early_years_policies(school_id,level,status,effective_start,effective_end);
CREATE INDEX early_years_observation_history ON early_years_observations(school_id,learner_id,observed_on DESC,created_at DESC,id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['early_years_policies','early_years_indicators','early_years_observations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY early_years_school_context ON %I USING(school_id::text=current_setting(''app.school_id'',true)) WITH CHECK(school_id::text=current_setting(''app.school_id'',true))',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON early_years_policies,early_years_indicators,early_years_observations TO school_app;
GRANT UPDATE(status,version,approved_by,approved_at,retired_by,retired_at,retirement_reason) ON early_years_policies TO school_app;
CREATE FUNCTION preserve_early_years_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_TABLE_NAME='early_years_policies' THEN
    IF ROW(NEW.id,NEW.school_id,NEW.level,NEW.title,NEW.source_kind,NEW.source_issuer,NEW.source_reference,NEW.source_version,NEW.effective_start,NEW.effective_end,NEW.specialist_name,NEW.specialist_qualification,NEW.specialist_review_reference,NEW.specialist_reviewed_on,NEW.created_by)
      IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.level,OLD.title,OLD.source_kind,OLD.source_issuer,OLD.source_reference,OLD.source_version,OLD.effective_start,OLD.effective_end,OLD.specialist_name,OLD.specialist_qualification,OLD.specialist_review_reference,OLD.specialist_reviewed_on,OLD.created_by)
      OR NEW.version<>OLD.version+1 OR NOT ((OLD.status='draft' AND NEW.status='approved' AND NEW.approved_by IS NOT NULL AND NEW.approved_at IS NOT NULL) OR (OLD.status='approved' AND NEW.status='retired' AND ROW(NEW.approved_by,NEW.approved_at) IS NOT DISTINCT FROM ROW(OLD.approved_by,OLD.approved_at) AND NEW.retired_by IS NOT NULL AND NEW.retired_at IS NOT NULL AND NEW.retirement_reason IS NOT NULL)) THEN
      RAISE EXCEPTION 'Early-years policy history is immutable' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='early_years_indicators' THEN
    RAISE EXCEPTION 'Early-years indicator history is immutable' USING ERRCODE='23514';
  ELSE
    RAISE EXCEPTION 'Early-years observation history is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION preserve_early_years_history() FROM PUBLIC;
CREATE TRIGGER early_years_policy_immutable BEFORE UPDATE ON early_years_policies FOR EACH ROW EXECUTE FUNCTION preserve_early_years_history();
CREATE TRIGGER early_years_indicator_immutable BEFORE UPDATE ON early_years_indicators FOR EACH ROW EXECUTE FUNCTION preserve_early_years_history();
CREATE TRIGGER early_years_observation_immutable BEFORE UPDATE ON early_years_observations FOR EACH ROW EXECUTE FUNCTION preserve_early_years_history();
CREATE FUNCTION early_years_policy_draft_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.status<>'draft' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.retired_by IS NOT NULL OR NEW.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'Early-years policies must be created as drafts' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION early_years_policy_draft_insert() FROM PUBLIC;
CREATE TRIGGER early_years_policy_draft_only BEFORE INSERT ON early_years_policies FOR EACH ROW EXECUTE FUNCTION early_years_policy_draft_insert();
CREATE FUNCTION early_years_indicator_draft_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE policy_status text;
BEGIN
  SELECT status INTO policy_status FROM early_years_policies WHERE school_id=NEW.school_id AND id=NEW.policy_id FOR UPDATE;
  IF policy_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Indicators can only be added to draft policies' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION early_years_indicator_draft_only() FROM PUBLIC;
CREATE TRIGGER early_years_indicator_draft_only BEFORE INSERT ON early_years_indicators FOR EACH ROW EXECUTE FUNCTION early_years_indicator_draft_only();
