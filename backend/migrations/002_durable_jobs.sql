CREATE ROLE school_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER TABLE memberships ADD CONSTRAINT membership_actor_unique UNIQUE(school_id,id,user_id);
ALTER TABLE outbox_jobs ADD COLUMN actor_user_id uuid;
UPDATE outbox_jobs j SET actor_user_id=m.user_id FROM memberships m WHERE m.school_id=j.school_id AND m.id=j.actor_membership_id;
ALTER TABLE outbox_jobs ALTER COLUMN actor_user_id SET NOT NULL;
ALTER TABLE outbox_jobs ADD CONSTRAINT job_actor_fk FOREIGN KEY(school_id,actor_membership_id,actor_user_id) REFERENCES memberships(school_id,id,user_id);
ALTER TABLE outbox_jobs ADD COLUMN lease_token uuid;
ALTER TABLE outbox_jobs ADD COLUMN result jsonb;
ALTER TABLE outbox_jobs ADD COLUMN last_error text;
ALTER TABLE outbox_jobs ADD COLUMN completed_at timestamptz;
ALTER TABLE outbox_jobs ADD CONSTRAINT job_attempt_limit CHECK(attempts BETWEEN 0 AND 3);
GRANT USAGE ON SCHEMA public TO school_worker;
GRANT SELECT,UPDATE ON outbox_jobs TO school_worker;
GRANT SELECT ON audit_events TO school_worker;
GRANT EXECUTE ON FUNCTION active_membership(uuid) TO school_worker;
CREATE FUNCTION pending_job_schools() RETURNS TABLE(school_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT DISTINCT j.school_id FROM public.outbox_jobs j
  WHERE (j.state='queued' AND j.available_at<=now()) OR (j.state='processing' AND j.lease_until<=now())
  ORDER BY j.school_id LIMIT 100
$$;
REVOKE ALL ON FUNCTION pending_job_schools() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pending_job_schools() TO school_worker;
