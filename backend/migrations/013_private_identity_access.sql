-- Identity lookups happen before school/user transaction context exists. Keep
-- them available to the private backend role while denying API roles access.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_backend_lookup ON users
  FOR SELECT TO school_app USING (true);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_backend_read ON sessions
  FOR SELECT TO school_app USING (true);
CREATE POLICY sessions_backend_insert ON sessions
  FOR INSERT TO school_app WITH CHECK (true);
CREATE POLICY sessions_backend_update ON sessions
  FOR UPDATE TO school_app USING (true) WITH CHECK (true);

DO $$
DECLARE
  api_role text;
  app_table text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      FOREACH app_table IN ARRAY ARRAY[
        'users','sessions','schools','memberships','audit_events','outbox_jobs',
        'command_receipts','academic_years','class_sections','learners','admissions',
        'enrolments','guardian_links','teaching_assignments','school_days',
        'attendance_registers','attendance_marks','attendance_corrections'
      ] LOOP
        IF to_regclass(format('public.%I',app_table)) IS NOT NULL THEN
          EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',app_table,api_role);
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Supabase's public-schema defaults had granted new objects to API roles.
  -- Scope this cleanup to public and the current migration owner only.
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',current_user,api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',current_user,api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I',current_user,api_role);
    END IF;
  END LOOP;
END $$;
