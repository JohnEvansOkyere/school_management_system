CREATE TABLE attendance_roster_snapshots (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL,
  register_id uuid NOT NULL,
  learner_id uuid NOT NULL,
  enrolment_id uuid NOT NULL,
  full_name text NOT NULL,
  admission_number text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,register_id,learner_id),
  FOREIGN KEY(school_id,register_id) REFERENCES attendance_registers(school_id,id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id),
  FOREIGN KEY(school_id,enrolment_id) REFERENCES enrolments(school_id,id)
);
ALTER TABLE attendance_roster_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_roster_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY attendance_roster_snapshot_school ON attendance_roster_snapshots
  USING(school_id::text=current_setting('app.school_id',true))
  WITH CHECK(school_id::text=current_setting('app.school_id',true));
GRANT SELECT,INSERT ON attendance_roster_snapshots TO school_app;
