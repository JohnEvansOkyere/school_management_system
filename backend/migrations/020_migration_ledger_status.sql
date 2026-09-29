-- Lets the restricted runtime role ask which migrations are recorded (for /readyz)
-- without any privilege on the ledger tables themselves.
CREATE FUNCTION migration_ledger_names() RETURNS SETOF text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF to_regclass('public.school_schema_migrations') IS NOT NULL THEN
    RETURN QUERY EXECUTE 'SELECT name FROM public.school_schema_migrations';
  ELSIF to_regclass('public.schema_migrations') IS NOT NULL THEN
    RETURN QUERY EXECUTE 'SELECT name FROM public.schema_migrations';
  END IF;
END $$;
REVOKE ALL ON FUNCTION migration_ledger_names() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION migration_ledger_names() TO school_app;
