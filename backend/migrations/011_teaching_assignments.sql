CREATE TABLE teaching_assignments (
  id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),class_id uuid NOT NULL,teacher_membership_id uuid NOT NULL,
  teacher_display_name text NOT NULL,start_date date NOT NULL,end_date date NOT NULL,CHECK(start_date<end_date),
  grant_reason text NOT NULL CHECK(length(btrim(grant_reason))>=3),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,revoked_by uuid,revocation_reason text,version integer NOT NULL DEFAULT 1 CHECK(version>0),UNIQUE(school_id,id),
  FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),
  FOREIGN KEY(school_id,teacher_membership_id) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,created_by) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,revoked_by) REFERENCES memberships(school_id,id),
  CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR
    (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revocation_reason IS NOT NULL AND length(btrim(revocation_reason))>=3)),
  EXCLUDE USING gist(school_id WITH =,class_id WITH =,teacher_membership_id WITH =,daterange(start_date,end_date,'[)') WITH &&) WHERE(revoked_at IS NULL)
);
CREATE INDEX teaching_scope ON teaching_assignments(school_id,teacher_membership_id,class_id,start_date,end_date) WHERE revoked_at IS NULL;
ALTER TABLE teaching_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY teaching_school_context ON teaching_assignments USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true));
GRANT SELECT,INSERT ON teaching_assignments TO school_app;
GRANT UPDATE(revoked_at,revoked_by,revocation_reason,version) ON teaching_assignments TO school_app;
CREATE FUNCTION preserve_teaching_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL OR
    ROW(NEW.id,NEW.school_id,NEW.class_id,NEW.teacher_membership_id,NEW.teacher_display_name,NEW.start_date,NEW.end_date,NEW.grant_reason,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.class_id,OLD.teacher_membership_id,OLD.teacher_display_name,OLD.start_date,OLD.end_date,OLD.grant_reason,OLD.created_by,OLD.created_at) THEN
    RAISE EXCEPTION 'Teaching assignment history is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER teaching_history_immutable BEFORE UPDATE ON teaching_assignments FOR EACH ROW EXECUTE FUNCTION preserve_teaching_assignment();
CREATE FUNCTION teacher_candidates(p_school uuid,p_member uuid DEFAULT NULL) RETURNS TABLE(id uuid,display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_school::text IS DISTINCT FROM current_setting('app.school_id',true) THEN RETURN; END IF;
  PERFORM m.id FROM public.memberships m WHERE m.school_id=p_school AND m.user_id::text=current_setting('app.user_id',true) AND m.role='headteacher' AND m.revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT m.id,u.display_name FROM public.memberships m JOIN public.users u ON u.id=m.user_id
    WHERE m.school_id=p_school AND m.role='teacher' AND m.revoked_at IS NULL AND (p_member IS NULL OR m.id=p_member) ORDER BY u.display_name,m.id FOR SHARE OF m;
END $$;
REVOKE ALL ON FUNCTION teacher_candidates(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION teacher_candidates(uuid,uuid) TO school_app;
