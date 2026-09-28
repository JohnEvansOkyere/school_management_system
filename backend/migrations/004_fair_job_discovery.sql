CREATE OR REPLACE FUNCTION pending_job_schools() RETURNS TABLE(school_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT j.school_id FROM public.outbox_jobs j
  WHERE (j.state='queued' AND j.available_at<=now()) OR (j.state='processing' AND j.lease_until<=now())
  GROUP BY j.school_id
  ORDER BY min(CASE WHEN j.state='processing' THEN j.lease_until ELSE j.available_at END),j.school_id
  LIMIT 100
$$;
