-- Headteachers manage the accounts of people in their own school. Each function re-checks that the caller is an
-- active headteacher of the school in the current request context; it never touches other schools or support access.
CREATE FUNCTION staff_require_head() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE school uuid := nullif(current_setting('app.school_id',true),'')::uuid; member_role text;
BEGIN
  SELECT role INTO member_role FROM public.active_membership(school);
  IF school IS NULL OR member_role IS DISTINCT FROM 'headteacher' THEN RAISE EXCEPTION 'Headteacher required' USING ERRCODE='42501'; END IF;
  RETURN school;
END $$;

CREATE FUNCTION staff_list() RETURNS TABLE(user_id uuid,membership_id uuid,display_name text,login text,role text,revoked_at timestamptz,must_change_password boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE school uuid := public.staff_require_head();
BEGIN
  RETURN QUERY SELECT u.id,m.id,u.display_name,u.synthetic_login,m.role,m.revoked_at,u.must_change_password
  FROM public.memberships m JOIN public.users u ON u.id=m.user_id WHERE m.school_id=school AND NOT m.support_access ORDER BY m.role,u.display_name,u.id;
END $$;

CREATE FUNCTION staff_create(p_name text,p_login text,p_hash text,p_role text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE school uuid := public.staff_require_head(); new_user uuid := gen_random_uuid();
BEGIN
  IF p_role NOT IN ('teacher','frontdesk','accountant','guardian') THEN RAISE EXCEPTION 'Role cannot be created by a headteacher' USING ERRCODE='22023'; END IF;
  INSERT INTO public.users(id,display_name,synthetic_login,password_hash,must_change_password) VALUES (new_user,p_name,lower(p_login),p_hash,true);
  INSERT INTO public.memberships(id,school_id,user_id,role) VALUES (gen_random_uuid(),school,new_user,p_role);
  RETURN new_user;
END $$;

CREATE FUNCTION staff_reset_password(p_user uuid,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE school uuid := public.staff_require_head();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE school_id=school AND user_id=p_user AND revoked_at IS NULL AND NOT support_access AND role<>'headteacher') THEN
    RAISE EXCEPTION 'User unavailable' USING ERRCODE='P0002';
  END IF;
  UPDATE public.users SET password_hash=p_hash,must_change_password=true WHERE id=p_user;
  UPDATE public.sessions SET revoked_at=now() WHERE user_id=p_user AND revoked_at IS NULL;
END $$;

CREATE FUNCTION staff_revoke(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE school uuid := public.staff_require_head();
BEGIN
  IF p_user::text=current_setting('app.user_id',true) THEN RAISE EXCEPTION 'You cannot remove your own access' USING ERRCODE='22023'; END IF;
  UPDATE public.memberships SET revoked_at=now() WHERE school_id=school AND user_id=p_user AND revoked_at IS NULL AND NOT support_access AND role<>'headteacher';
  IF NOT FOUND THEN RAISE EXCEPTION 'User unavailable' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE user_id=p_user AND revoked_at IS NULL) THEN
    UPDATE public.sessions SET revoked_at=now() WHERE user_id=p_user AND revoked_at IS NULL;
  END IF;
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['staff_require_head()','staff_list()','staff_create(text,text,text,text)','staff_reset_password(uuid,text)','staff_revoke(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO school_app',fn);
  END LOOP;
END $$;
