CREATE TABLE guardian_links (
  id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),learner_id uuid NOT NULL,guardian_membership_id uuid NOT NULL,
  academic boolean NOT NULL,billing boolean NOT NULL,pickup boolean NOT NULL,contact boolean NOT NULL,
  verified_at timestamptz,verified_by uuid,verification_reason text,
  revoked_at timestamptz,revoked_by uuid,revocation_reason text,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(school_id,id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id),
  FOREIGN KEY(school_id,guardian_membership_id) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,verified_by) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,revoked_by) REFERENCES memberships(school_id,id),
  CHECK(academic OR billing OR pickup OR contact),
  CHECK((verified_at IS NULL AND verified_by IS NULL AND verification_reason IS NULL) OR (verified_at IS NOT NULL AND verified_by IS NOT NULL AND length(btrim(verification_reason))>=3)),
  CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(btrim(revocation_reason))>=3))
);
CREATE UNIQUE INDEX guardian_active_pair ON guardian_links(school_id,learner_id,guardian_membership_id) WHERE revoked_at IS NULL;
CREATE INDEX guardian_child_access ON guardian_links(school_id,guardian_membership_id,learner_id) WHERE revoked_at IS NULL AND verified_at IS NOT NULL;
ALTER TABLE guardian_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_links FORCE ROW LEVEL SECURITY;
CREATE POLICY guardian_school_context ON guardian_links USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true));
GRANT SELECT,INSERT ON guardian_links TO school_app;
GRANT UPDATE(verified_at,verified_by,verification_reason,revoked_at,revoked_by,revocation_reason,version) ON guardian_links TO school_app;
CREATE FUNCTION preserve_guardian_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL OR
    (OLD.verified_at IS NOT NULL AND (NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verification_reason IS DISTINCT FROM OLD.verification_reason)) THEN
    RAISE EXCEPTION 'Guardian verification and revocation history is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guardian_history_immutable BEFORE UPDATE ON guardian_links FOR EACH ROW EXECUTE FUNCTION preserve_guardian_link();
CREATE FUNCTION guardian_candidates(p_school uuid) RETURNS TABLE(id uuid,display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_school::text IS DISTINCT FROM current_setting('app.school_id',true) THEN RETURN; END IF;
  PERFORM m.id FROM public.memberships m WHERE m.school_id=p_school AND m.user_id::text=current_setting('app.user_id',true) AND m.role='headteacher' AND m.revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT m.id,u.display_name FROM public.memberships m JOIN public.users u ON u.id=m.user_id WHERE m.school_id=p_school AND m.role='guardian' AND m.revoked_at IS NULL ORDER BY u.display_name,m.id;
END $$;
REVOKE ALL ON FUNCTION guardian_candidates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION guardian_candidates(uuid) TO school_app;
CREATE FUNCTION lock_guardian_membership(p_school uuid,p_member uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_school::text IS DISTINCT FROM current_setting('app.school_id',true) THEN RETURN false; END IF;
  PERFORM m.id FROM public.memberships m WHERE m.school_id=p_school AND m.user_id::text=current_setting('app.user_id',true) AND m.role='headteacher' AND m.revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM m.id FROM public.memberships m WHERE m.school_id=p_school AND m.id=p_member AND m.role='guardian' AND m.revoked_at IS NULL FOR SHARE;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION lock_guardian_membership(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_guardian_membership(uuid,uuid) TO school_app;
