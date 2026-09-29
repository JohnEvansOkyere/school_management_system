-- TOTP multi-factor authentication for privileged roles (headteacher, accountant, platform administrator).
-- Secrets are stored encrypted by the application; recovery codes are stored only as hashes.
CREATE TABLE user_mfa (
  user_id uuid PRIMARY KEY REFERENCES users(id), secret_ciphertext text NOT NULL, confirmed_at timestamptz,
  last_used_step bigint NOT NULL DEFAULT 0, failed_attempts integer NOT NULL DEFAULT 0, locked_until timestamptz,
  recovery_hashes jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_mfa ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mfa FORCE ROW LEVEL SECURITY;
CREATE POLICY user_mfa_own ON user_mfa USING(user_id::text=current_setting('app.user_id',true)) WITH CHECK(user_id::text=current_setting('app.user_id',true));
GRANT SELECT,INSERT ON user_mfa TO school_app;
GRANT UPDATE(secret_ciphertext,confirmed_at,last_used_step,failed_attempts,locked_until,recovery_hashes) ON user_mfa TO school_app;
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;
CREATE FUNCTION user_requires_mfa() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id::text=current_setting('app.user_id',true))
      OR EXISTS (SELECT 1 FROM public.memberships WHERE user_id::text=current_setting('app.user_id',true) AND revoked_at IS NULL AND NOT support_access AND role IN ('headteacher','accountant'))
$$;
REVOKE ALL ON FUNCTION user_requires_mfa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_requires_mfa() TO school_app;
