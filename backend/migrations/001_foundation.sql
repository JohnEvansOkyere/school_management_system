CREATE TABLE users (id uuid PRIMARY KEY, display_name text NOT NULL, synthetic_login text UNIQUE NOT NULL, password_hash text NOT NULL);
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf_token text NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz);
CREATE TABLE schools (id uuid PRIMARY KEY, name text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version > 0));
CREATE TABLE memberships (id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id), user_id uuid NOT NULL REFERENCES users(id), role text NOT NULL CHECK(role IN ('headteacher','teacher','accountant','frontdesk','guardian')), revoked_at timestamptz, UNIQUE(school_id,id), UNIQUE(school_id,user_id));
CREATE TABLE audit_events (id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id), actor_membership_id uuid NOT NULL, action text NOT NULL, target_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}', UNIQUE(school_id,id), FOREIGN KEY(school_id,actor_membership_id) REFERENCES memberships(school_id,id));
CREATE TABLE outbox_jobs (id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id), actor_membership_id uuid NOT NULL, kind text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','done','failed','cancelled')), attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, UNIQUE(school_id,id), FOREIGN KEY(school_id,actor_membership_id) REFERENCES memberships(school_id,id));
CREATE INDEX audit_school_date ON audit_events(school_id,created_at DESC);
CREATE INDEX jobs_school_state ON outbox_jobs(school_id,state,available_at);
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools FORCE ROW LEVEL SECURITY;
CREATE POLICY school_context ON schools USING (id::text = current_setting('app.school_id',true)) WITH CHECK (id::text = current_setting('app.school_id',true));
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY own_membership ON memberships USING (user_id::text = current_setting('app.user_id',true));
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_context ON audit_events USING (school_id::text = current_setting('app.school_id',true)) WITH CHECK (school_id::text = current_setting('app.school_id',true));
ALTER TABLE outbox_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY jobs_context ON outbox_jobs USING (school_id::text = current_setting('app.school_id',true)) WITH CHECK (school_id::text = current_setting('app.school_id',true));
GRANT USAGE ON SCHEMA public TO school_app;
GRANT SELECT ON users,memberships TO school_app;
GRANT SELECT,INSERT,UPDATE ON sessions TO school_app;
GRANT SELECT,UPDATE ON schools TO school_app;
GRANT SELECT,INSERT ON audit_events TO school_app;
GRANT SELECT,INSERT,UPDATE ON outbox_jobs TO school_app;
CREATE FUNCTION active_membership(p_school uuid) RETURNS TABLE(id uuid,role text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
  SELECT m.id,m.role FROM public.memberships m
  WHERE m.school_id=p_school AND m.user_id::text=current_setting('app.user_id',true) AND m.revoked_at IS NULL
  FOR SHARE
$$;
REVOKE ALL ON FUNCTION active_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION active_membership(uuid) TO school_app;
