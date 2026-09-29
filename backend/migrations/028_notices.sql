-- Notices to guardians: head-approved, recipient list frozen at approval, in-app for everyone and SMS where a phone exists.
-- SMS sends are at-most-once: a delivery is claimed as 'sending' before the provider is called and never retried automatically.
ALTER TABLE users ADD COLUMN phone text CHECK(phone IS NULL OR phone ~ '^\+233[0-9]{9}$');
DROP FUNCTION staff_list();
CREATE FUNCTION staff_list() RETURNS TABLE(user_id uuid,membership_id uuid,display_name text,login text,role text,revoked_at timestamptz,must_change_password boolean,phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE school uuid := public.staff_require_head();
BEGIN
  RETURN QUERY SELECT u.id,m.id,u.display_name,u.synthetic_login,m.role,m.revoked_at,u.must_change_password,u.phone
  FROM public.memberships m JOIN public.users u ON u.id=m.user_id WHERE m.school_id=school AND NOT m.support_access ORDER BY m.role,u.display_name,u.id;
END $$;
REVOKE ALL ON FUNCTION staff_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_list() TO school_app;
CREATE FUNCTION staff_set_phone(p_user uuid,p_phone text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE school uuid := public.staff_require_head();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE school_id=school AND user_id=p_user AND revoked_at IS NULL AND NOT support_access) THEN RAISE EXCEPTION 'User unavailable' USING ERRCODE='P0002'; END IF;
  UPDATE public.users SET phone=p_phone WHERE id=p_user;
END $$;
REVOKE ALL ON FUNCTION staff_set_phone(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_set_phone(uuid,text) TO school_app;

CREATE TABLE notices (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, title text NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 100), body text NOT NULL CHECK(length(btrim(body)) BETWEEN 3 AND 320),
  audience text NOT NULL CHECK(audience IN ('school','class')), class_id uuid, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_by uuid, approved_at timestamptz,
  UNIQUE(school_id,id), CHECK((audience='class')=(class_id IS NOT NULL)), CHECK(status<>'approved' OR approved_by IS NOT NULL), CHECK(status<>'draft' OR approved_by IS NULL),
  FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id), FOREIGN KEY(school_id,created_by) REFERENCES memberships(school_id,id), FOREIGN KEY(school_id,approved_by) REFERENCES memberships(school_id,id)
);
CREATE TABLE notice_deliveries (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, notice_id uuid NOT NULL, guardian_membership_id uuid NOT NULL, to_phone text CHECK(to_phone IS NULL OR to_phone ~ '^\+233[0-9]{9}$'),
  state text NOT NULL CHECK(state IN ('in_app_only','queued','sending','sent','suppressed','failed','cancelled')), provider text, provider_message_id text,
  attempts integer NOT NULL DEFAULT 0, last_error text, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,notice_id,guardian_membership_id), FOREIGN KEY(school_id,notice_id) REFERENCES notices(school_id,id), FOREIGN KEY(school_id,guardian_membership_id) REFERENCES memberships(school_id,id)
);
CREATE INDEX notice_deliveries_pending ON notice_deliveries(school_id,state);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notices','notice_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON notices,notice_deliveries TO school_app;
GRANT UPDATE(status,version,approved_by,approved_at) ON notices TO school_app;
GRANT UPDATE(state,last_error,updated_at) ON notice_deliveries TO school_app;
GRANT SELECT ON notices TO school_worker;
GRANT SELECT ON notice_deliveries TO school_worker;
GRANT UPDATE(state,provider,provider_message_id,attempts,last_error,updated_at) ON notice_deliveries TO school_worker;
CREATE FUNCTION pending_delivery_schools() RETURNS TABLE(school_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT DISTINCT d.school_id FROM public.notice_deliveries d WHERE d.state='queued' OR (d.state='sending' AND d.updated_at<now()-interval '5 minutes') ORDER BY d.school_id LIMIT 100
$$;
REVOKE ALL ON FUNCTION pending_delivery_schools() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pending_delivery_schools() TO school_worker;
-- Guardians a notice reaches: verified, unrevoked contact right on a currently enrolled learner (optionally in one class). The
-- phone comes from the guardian's account, which the application role cannot read directly.
CREATE FUNCTION notice_recipients(p_class uuid) RETURNS TABLE(guardian_membership_id uuid,phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE school uuid := public.staff_require_head(); today date := (now() AT TIME ZONE 'Africa/Accra')::date;
BEGIN
  RETURN QUERY SELECT DISTINCT ON (g.guardian_membership_id) g.guardian_membership_id,u.phone
  FROM public.guardian_links g
  JOIN public.memberships m ON m.school_id=g.school_id AND m.id=g.guardian_membership_id AND m.revoked_at IS NULL AND m.role='guardian'
  JOIN public.users u ON u.id=m.user_id
  JOIN public.enrolments e ON e.school_id=g.school_id AND e.learner_id=g.learner_id AND e.start_date<=today AND (e.end_date IS NULL OR e.end_date>today)
  WHERE g.school_id=school AND g.contact AND g.verified_at IS NOT NULL AND g.revoked_at IS NULL AND (p_class IS NULL OR e.class_id=p_class)
  ORDER BY g.guardian_membership_id;
END $$;
REVOKE ALL ON FUNCTION notice_recipients(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notice_recipients(uuid) TO school_app;
