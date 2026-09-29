-- Platform administrator: creates school accounts and may enter any school for support.
-- Every privileged action goes through a definer function that checks platform_admins and writes an audit event
-- inside the affected school, so school headteachers can see when the platform administrator acted.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE memberships ADD COLUMN support_access boolean NOT NULL DEFAULT false;
CREATE TABLE platform_admins (user_id uuid PRIMARY KEY REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_admins FROM PUBLIC;

-- A support membership only works while its user is still a platform administrator.
CREATE OR REPLACE FUNCTION active_membership(p_school uuid) RETURNS TABLE(id uuid,role text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
  SELECT m.id,m.role FROM public.memberships m
  WHERE m.school_id=p_school AND m.user_id::text=current_setting('app.user_id',true) AND m.revoked_at IS NULL
    AND (NOT m.support_access OR EXISTS (SELECT 1 FROM public.platform_admins p WHERE p.user_id=m.user_id))
  FOR SHARE
$$;

CREATE FUNCTION is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id::text=current_setting('app.user_id',true))
$$;

CREATE FUNCTION platform_require_admin() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE admin_id uuid;
BEGIN
  SELECT user_id INTO admin_id FROM public.platform_admins WHERE user_id::text=current_setting('app.user_id',true);
  IF admin_id IS NULL THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE='42501'; END IF;
  RETURN admin_id;
END $$;

-- Returns the administrator's membership in the school, creating a support membership when none exists.
-- Only platform_enter_school (p_active) leaves it usable; other actions create it revoked, just to satisfy audit foreign keys.
CREATE FUNCTION platform_support_membership(p_school uuid,p_active boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE admin_id uuid := public.platform_require_admin(); member_id uuid;
BEGIN
  SELECT id INTO member_id FROM public.memberships WHERE school_id=p_school AND user_id=admin_id;
  IF member_id IS NULL THEN
    member_id := gen_random_uuid();
    INSERT INTO public.memberships(id,school_id,user_id,role,support_access,revoked_at) VALUES (member_id,p_school,admin_id,'headteacher',true,CASE WHEN p_active THEN NULL ELSE now() END);
  ELSIF p_active THEN
    UPDATE public.memberships SET revoked_at=NULL WHERE id=member_id AND support_access AND revoked_at IS NOT NULL;
  END IF;
  RETURN member_id;
END $$;

CREATE FUNCTION platform_schools() RETURNS TABLE(id uuid,name text,members bigint,headteachers bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$
BEGIN
  PERFORM public.platform_require_admin();
  RETURN QUERY SELECT s.id,s.name,
    count(m.id) FILTER (WHERE m.revoked_at IS NULL AND NOT m.support_access),
    count(m.id) FILTER (WHERE m.revoked_at IS NULL AND NOT m.support_access AND m.role='headteacher')
  FROM public.schools s LEFT JOIN public.memberships m ON m.school_id=s.id GROUP BY s.id,s.name ORDER BY s.name,s.id;
END $$;

CREATE FUNCTION platform_create_school(p_name text,p_head_name text,p_head_login text,p_head_hash text)
RETURNS TABLE(school_id uuid,user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE admin_id uuid := public.platform_require_admin(); new_school uuid := gen_random_uuid(); new_user uuid := gen_random_uuid(); support uuid;
BEGIN
  INSERT INTO public.schools(id,name) VALUES (new_school,p_name);
  INSERT INTO public.users(id,display_name,synthetic_login,password_hash,must_change_password) VALUES (new_user,p_head_name,lower(p_head_login),p_head_hash,true);
  INSERT INTO public.memberships(id,school_id,user_id,role) VALUES (gen_random_uuid(),new_school,new_user,'headteacher');
  support := public.platform_support_membership(new_school,false);
  INSERT INTO public.audit_events(id,school_id,actor_membership_id,action,target_id,metadata)
    VALUES (gen_random_uuid(),new_school,support,'platform.school.created',new_school,jsonb_build_object('headteacherUserId',new_user));
  RETURN QUERY SELECT new_school,new_user;
END $$;

CREATE FUNCTION platform_create_user(p_school uuid,p_name text,p_login text,p_hash text,p_role text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE new_user uuid := gen_random_uuid(); support uuid;
BEGIN
  PERFORM public.platform_require_admin();
  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id=p_school) THEN RAISE EXCEPTION 'School unavailable' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.users(id,display_name,synthetic_login,password_hash,must_change_password) VALUES (new_user,p_name,lower(p_login),p_hash,true);
  INSERT INTO public.memberships(id,school_id,user_id,role) VALUES (gen_random_uuid(),p_school,new_user,p_role);
  support := public.platform_support_membership(p_school,false);
  INSERT INTO public.audit_events(id,school_id,actor_membership_id,action,target_id,metadata)
    VALUES (gen_random_uuid(),p_school,support,'platform.user.created',new_user,jsonb_build_object('role',p_role));
  RETURN new_user;
END $$;

CREATE FUNCTION platform_enter_school(p_school uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE support uuid;
BEGIN
  PERFORM public.platform_require_admin();
  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id=p_school) THEN RAISE EXCEPTION 'School unavailable' USING ERRCODE='P0002'; END IF;
  support := public.platform_support_membership(p_school,true);
  INSERT INTO public.audit_events(id,school_id,actor_membership_id,action,target_id,metadata)
    VALUES (gen_random_uuid(),p_school,support,'platform.support_access.entered',p_school,'{}');
  RETURN support;
END $$;

CREATE FUNCTION platform_reset_password(p_school uuid,p_user uuid,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE support uuid;
BEGIN
  PERFORM public.platform_require_admin();
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE school_id=p_school AND user_id=p_user AND revoked_at IS NULL AND NOT support_access) THEN
    RAISE EXCEPTION 'User unavailable' USING ERRCODE='P0002';
  END IF;
  UPDATE public.users SET password_hash=p_hash,must_change_password=true WHERE id=p_user;
  UPDATE public.sessions SET revoked_at=now() WHERE user_id=p_user AND revoked_at IS NULL;
  support := public.platform_support_membership(p_school,false);
  INSERT INTO public.audit_events(id,school_id,actor_membership_id,action,target_id,metadata)
    VALUES (gen_random_uuid(),p_school,support,'platform.password.reset',p_user,'{}');
END $$;

-- Lets a signed-in user replace their own password; other sessions are revoked.
CREATE FUNCTION change_own_password(p_hash text,p_keep_token text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE me uuid := nullif(current_setting('app.user_id',true),'')::uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
  UPDATE public.users SET password_hash=p_hash,must_change_password=false WHERE id=me;
  UPDATE public.sessions SET revoked_at=now() WHERE user_id=me AND revoked_at IS NULL AND token_hash<>p_keep_token;
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['is_platform_admin()','platform_require_admin()','platform_support_membership(uuid,boolean)','platform_schools()','platform_create_school(text,text,text,text)','platform_create_user(uuid,text,text,text,text)','platform_enter_school(uuid)','platform_reset_password(uuid,uuid,text)','change_own_password(text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO school_app',fn);
  END LOOP;
END $$;
