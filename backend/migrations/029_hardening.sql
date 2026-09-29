-- 1. A headteacher may act on an account only when it belongs to nobody else: no active membership in another school and not a
--    platform administrator. Accounts created through staff_create satisfy this; the guard covers accounts attached by other means.
CREATE OR REPLACE FUNCTION staff_reset_password(p_user uuid,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE school uuid := public.staff_require_head();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE school_id=school AND user_id=p_user AND revoked_at IS NULL AND NOT support_access AND role<>'headteacher')
    OR EXISTS (SELECT 1 FROM public.memberships o WHERE o.user_id=p_user AND o.school_id<>school AND o.revoked_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p_user) THEN
    RAISE EXCEPTION 'User unavailable' USING ERRCODE='P0002';
  END IF;
  UPDATE public.users SET password_hash=p_hash,must_change_password=true WHERE id=p_user;
  UPDATE public.sessions SET revoked_at=now() WHERE user_id=p_user AND revoked_at IS NULL;
END $$;
CREATE OR REPLACE FUNCTION staff_set_phone(p_user uuid,p_phone text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE school uuid := public.staff_require_head();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE school_id=school AND user_id=p_user AND revoked_at IS NULL AND NOT support_access)
    OR EXISTS (SELECT 1 FROM public.memberships o WHERE o.user_id=p_user AND o.school_id<>school AND o.revoked_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=p_user) THEN
    RAISE EXCEPTION 'User unavailable' USING ERRCODE='P0002';
  END IF;
  UPDATE public.users SET phone=p_phone WHERE id=p_user;
END $$;

-- 2. Housekeeping for the worker: expired/revoked sessions and old retry receipts. Audit history is never touched.
CREATE FUNCTION purge_expired() RETURNS TABLE(sessions_deleted bigint,receipts_deleted bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE s bigint; r bigint;
BEGIN
  DELETE FROM public.sessions WHERE expires_at<now()-interval '30 days' OR (revoked_at IS NOT NULL AND revoked_at<now()-interval '30 days');
  GET DIAGNOSTICS s = ROW_COUNT;
  DELETE FROM public.command_receipts WHERE created_at<now()-interval '30 days';
  GET DIAGNOSTICS r = ROW_COUNT;
  RETURN QUERY SELECT s,r;
END $$;
REVOKE ALL ON FUNCTION purge_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired() TO school_worker;

-- 3. Index every foreign key that has no index starting with its columns (joins and parent deletes scan otherwise).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.conname,c.conrelid,c.conrelid::regclass AS tbl,c.conkey FROM pg_constraint c WHERE c.contype='f' AND c.connamespace='public'::regnamespace ORDER BY c.conrelid,c.conname LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i WHERE i.indrelid=r.conrelid
        AND (SELECT array_agg(t.x ORDER BY t.o) FROM unnest(i.indkey::int2[]) WITH ORDINALITY t(x,o) WHERE t.o<=array_length(r.conkey,1))=r.conkey
    ) THEN
      EXECUTE format('CREATE INDEX %I ON %s (%s)','fk_'||substr(md5(r.conname||r.conrelid::text),1,12),r.tbl,
        (SELECT string_agg(quote_ident(a.attname),',' ORDER BY k.o) FROM unnest(r.conkey) WITH ORDINALITY k(n,o) JOIN pg_attribute a ON a.attrelid=r.conrelid AND a.attnum=k.n));
    END IF;
  END LOOP;
END $$;
