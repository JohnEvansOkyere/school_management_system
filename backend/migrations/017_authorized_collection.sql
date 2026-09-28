ALTER TABLE guardian_links ADD CONSTRAINT guardian_link_child_identity UNIQUE(school_id,learner_id,id);
CREATE TABLE collection_cases (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,learner_id uuid NOT NULL,date date NOT NULL,
  collector_name text NOT NULL CHECK(length(btrim(collector_name)) BETWEEN 3 AND 120),request_reason text NOT NULL CHECK(length(btrim(request_reason)) BETWEEN 3 AND 500),
  requested_by uuid NOT NULL,requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined','cancelled','used')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),reviewed_by uuid,reviewed_at timestamptz,decision_reason text,review_verification text,
  cancelled_by uuid,cancelled_at timestamptz,cancellation_reason text,
  UNIQUE(school_id,learner_id,id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id),
  FOREIGN KEY(school_id,requested_by) REFERENCES memberships(school_id,id),FOREIGN KEY(school_id,reviewed_by) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,cancelled_by) REFERENCES memberships(school_id,id),
  CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND decision_reason IS NULL AND review_verification IS NULL) OR
    (status IN ('approved','used','declined','cancelled') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND decision_reason IS NOT NULL AND length(btrim(decision_reason))>=3 AND (status='declined' OR (review_verification IS NOT NULL AND length(btrim(review_verification))>=3)))),
  CHECK((status='cancelled' AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL AND length(btrim(cancellation_reason))>=3) OR (status<>'cancelled' AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL))
);
CREATE TABLE collection_events (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,learner_id uuid NOT NULL,date date NOT NULL,
  learner_name text NOT NULL,admission_number text NOT NULL,class_id uuid NOT NULL,class_name text NOT NULL,enrolment_id uuid NOT NULL,
  guardian_link_id uuid,guardian_link_version integer,exception_id uuid,
  collector_name text NOT NULL,verification_reason text NOT NULL CHECK(length(btrim(verification_reason)) BETWEEN 3 AND 500),
  released_by uuid NOT NULL,released_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1 CHECK(version>0),
  voided_by uuid,voided_at timestamptz,void_reason text,
  UNIQUE(school_id,id),UNIQUE(exception_id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id),FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),
  FOREIGN KEY(school_id,enrolment_id) REFERENCES enrolments(school_id,id),
  FOREIGN KEY(school_id,learner_id,guardian_link_id) REFERENCES guardian_links(school_id,learner_id,id),
  FOREIGN KEY(school_id,learner_id,exception_id) REFERENCES collection_cases(school_id,learner_id,id),
  FOREIGN KEY(school_id,released_by) REFERENCES memberships(school_id,id),FOREIGN KEY(school_id,voided_by) REFERENCES memberships(school_id,id),
  CHECK((guardian_link_id IS NOT NULL AND guardian_link_version IS NOT NULL AND guardian_link_version>0 AND exception_id IS NULL) OR (guardian_link_id IS NULL AND guardian_link_version IS NULL AND exception_id IS NOT NULL)),
  CHECK((voided_by IS NULL AND voided_at IS NULL AND void_reason IS NULL) OR (voided_by IS NOT NULL AND voided_at IS NOT NULL AND void_reason IS NOT NULL AND length(btrim(void_reason))>=3))
);
CREATE UNIQUE INDEX collection_one_active_release ON collection_events(school_id,learner_id,date) WHERE voided_at IS NULL;
CREATE INDEX collection_case_child_history ON collection_cases(school_id,learner_id,requested_at DESC,id);
CREATE INDEX collection_event_child_history ON collection_events(school_id,learner_id,released_at DESC,id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['collection_cases','collection_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY collection_school_context ON %I USING(school_id::text=current_setting(''app.school_id'',true)) WITH CHECK(school_id::text=current_setting(''app.school_id'',true))',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON collection_cases,collection_events TO school_app;
GRANT UPDATE(status,version,reviewed_by,reviewed_at,decision_reason,review_verification,cancelled_by,cancelled_at,cancellation_reason) ON collection_cases TO school_app;
GRANT UPDATE(version,voided_by,voided_at,void_reason) ON collection_events TO school_app;
CREATE FUNCTION preserve_collection_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_TABLE_NAME='collection_events' THEN
    IF OLD.voided_at IS NOT NULL OR (to_jsonb(NEW)-ARRAY['version','voided_by','voided_at','void_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','voided_by','voided_at','void_reason'])
      OR NEW.version<>OLD.version+1 OR NEW.voided_at IS NULL THEN
      RAISE EXCEPTION 'Collection release history is immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['status','version','reviewed_by','reviewed_at','decision_reason','review_verification','cancelled_by','cancelled_at','cancellation_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','reviewed_by','reviewed_at','decision_reason','review_verification','cancelled_by','cancelled_at','cancellation_reason'])
      OR NEW.version<>OLD.version+1 OR NOT ((OLD.status='pending' AND NEW.status IN ('approved','declined')) OR (OLD.status='approved' AND NEW.status IN ('cancelled','used')))
      OR (OLD.status='approved' AND ROW(NEW.reviewed_by,NEW.reviewed_at,NEW.decision_reason,NEW.review_verification) IS DISTINCT FROM ROW(OLD.reviewed_by,OLD.reviewed_at,OLD.decision_reason,OLD.review_verification)) THEN
      RAISE EXCEPTION 'Collection request and review history is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION preserve_collection_history() FROM PUBLIC;
CREATE TRIGGER collection_event_immutable BEFORE UPDATE ON collection_events FOR EACH ROW EXECUTE FUNCTION preserve_collection_history();
CREATE TRIGGER collection_case_immutable BEFORE UPDATE ON collection_cases FOR EACH ROW EXECUTE FUNCTION preserve_collection_history();
CREATE FUNCTION collection_pickup_authority(p_school uuid,p_learner uuid,p_link uuid DEFAULT NULL)
RETURNS TABLE(id uuid,version integer,collector_name text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE link public.guardian_links;
BEGIN
  IF p_school::text IS DISTINCT FROM current_setting('app.school_id',true) THEN RETURN; END IF;
  PERFORM m.id FROM public.memberships m WHERE m.school_id=p_school AND m.user_id::text=current_setting('app.user_id',true) AND m.role IN ('headteacher','frontdesk') AND m.revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  FOR link IN SELECT g.* FROM public.guardian_links g WHERE g.school_id=p_school AND g.learner_id=p_learner AND g.pickup AND g.verified_at IS NOT NULL AND g.revoked_at IS NULL AND (p_link IS NULL OR g.id=p_link) ORDER BY g.id FOR SHARE LOOP
    PERFORM m.id FROM public.memberships m WHERE m.school_id=p_school AND m.id=link.guardian_membership_id AND m.role='guardian' AND m.revoked_at IS NULL FOR SHARE;
    IF FOUND THEN id:=link.id;version:=link.version;collector_name:=link.guardian_display_name;RETURN NEXT; END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION collection_pickup_authority(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collection_pickup_authority(uuid,uuid,uuid) TO school_app;
CREATE FUNCTION collection_live_reviewer(p_school uuid,p_member uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_school::text IS DISTINCT FROM current_setting('app.school_id',true) THEN RETURN false; END IF;
  PERFORM m.id FROM public.memberships m WHERE m.school_id=p_school AND m.user_id::text=current_setting('app.user_id',true) AND m.role IN ('headteacher','frontdesk') AND m.revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM m.id FROM public.memberships m WHERE m.school_id=p_school AND m.id=p_member AND m.role='headteacher' AND m.revoked_at IS NULL FOR SHARE;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION collection_live_reviewer(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collection_live_reviewer(uuid,uuid) TO school_app;
