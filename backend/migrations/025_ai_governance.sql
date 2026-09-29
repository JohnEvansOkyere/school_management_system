-- AI governance: per-school switch and cap, append-only run log and feedback. Prompts and generated text are not stored.
CREATE TABLE ai_settings (
  school_id uuid PRIMARY KEY REFERENCES schools(id), enabled boolean NOT NULL DEFAULT false,
  monthly_run_cap integer NOT NULL DEFAULT 200 CHECK(monthly_run_cap BETWEEN 1 AND 5000),
  acknowledgement text CHECK(acknowledgement IS NULL OR length(btrim(acknowledgement)) BETWEEN 10 AND 500),
  updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0),
  CHECK(NOT enabled OR acknowledgement IS NOT NULL), FOREIGN KEY(school_id,updated_by) REFERENCES memberships(school_id,id)
);
CREATE TABLE ai_runs (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, actor_membership_id uuid NOT NULL, feature text NOT NULL CHECK(length(feature) BETWEEN 3 AND 60),
  template_version text NOT NULL, provider text NOT NULL, model text, source text NOT NULL CHECK(source IN ('ai','template')),
  status text NOT NULL CHECK(status IN ('ok','fallback')), source_refs jsonb NOT NULL, output_digest text NOT NULL CHECK(output_digest ~ '^[0-9a-f]{64}$'),
  input_tokens integer, output_tokens integer, latency_ms integer, note text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id), FOREIGN KEY(school_id,actor_membership_id) REFERENCES memberships(school_id,id)
);
CREATE INDEX ai_runs_month ON ai_runs(school_id,created_at DESC);
CREATE TABLE ai_run_feedback (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, run_id uuid NOT NULL, actor_membership_id uuid NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('accepted','edited','discarded')), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,run_id,actor_membership_id), FOREIGN KEY(school_id,run_id) REFERENCES ai_runs(school_id,id), FOREIGN KEY(school_id,actor_membership_id) REFERENCES memberships(school_id,id)
);
CREATE TRIGGER ai_runs_append_only BEFORE UPDATE OR DELETE ON ai_runs FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER ai_run_feedback_append_only BEFORE UPDATE OR DELETE ON ai_run_feedback FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_settings','ai_runs','ai_run_feedback'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON ai_runs,ai_run_feedback,ai_settings TO school_app;
GRANT UPDATE(enabled,monthly_run_cap,acknowledgement,updated_by,updated_at,version) ON ai_settings TO school_app;
