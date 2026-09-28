CREATE TABLE school_days (
  id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),day date NOT NULL,is_open boolean NOT NULL,reason text NOT NULL CHECK(length(btrim(reason))>=3),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(school_id,day),UNIQUE(school_id,id),
  FOREIGN KEY(school_id,created_by) REFERENCES memberships(school_id,id)
);
CREATE TABLE attendance_registers (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,class_id uuid NOT NULL,day date NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','locked')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by uuid NOT NULL,submitted_at timestamptz,submitted_by uuid,locked_at timestamptz,locked_by uuid,created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,class_id,day),UNIQUE(school_id,id),FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),FOREIGN KEY(school_id,created_by) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,submitted_by) REFERENCES memberships(school_id,id),FOREIGN KEY(school_id,locked_by) REFERENCES memberships(school_id,id),
  CHECK((status='draft' AND submitted_at IS NULL AND submitted_by IS NULL AND locked_at IS NULL AND locked_by IS NULL) OR
    (status='submitted' AND submitted_at IS NOT NULL AND submitted_by IS NOT NULL AND locked_at IS NULL AND locked_by IS NULL) OR
    (status='locked' AND submitted_at IS NOT NULL AND submitted_by IS NOT NULL AND locked_at IS NOT NULL AND locked_by IS NOT NULL))
);
CREATE TABLE attendance_marks (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,register_id uuid NOT NULL,learner_id uuid NOT NULL,enrolment_id uuid NOT NULL,mark text NOT NULL CHECK(mark IN ('unmarked','present','late','absent','excused')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(school_id,id),UNIQUE(school_id,register_id,learner_id),FOREIGN KEY(school_id,register_id) REFERENCES attendance_registers(school_id,id),FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id),FOREIGN KEY(school_id,enrolment_id) REFERENCES enrolments(school_id,id)
);
CREATE TABLE attendance_corrections (
  id uuid PRIMARY KEY,school_id uuid NOT NULL,register_id uuid NOT NULL,learner_id uuid NOT NULL,old_mark text NOT NULL,new_mark text NOT NULL,reason text NOT NULL CHECK(length(btrim(reason))>=3),reviewer_membership_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),FOREIGN KEY(school_id,register_id) REFERENCES attendance_registers(school_id,id),FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id),FOREIGN KEY(school_id,reviewer_membership_id) REFERENCES memberships(school_id,id)
);
CREATE INDEX attendance_register_day ON attendance_registers(school_id,class_id,day);
CREATE INDEX attendance_marks_register ON attendance_marks(school_id,register_id);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['school_days','attendance_registers','attendance_marks','attendance_corrections'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t); EXECUTE format('CREATE POLICY attendance_school_context ON %I USING(school_id::text=current_setting(''app.school_id'',true)) WITH CHECK(school_id::text=current_setting(''app.school_id'',true))',t); END LOOP; END $$;
GRANT SELECT,INSERT,UPDATE ON school_days TO school_app;
GRANT SELECT,INSERT,UPDATE ON attendance_registers,attendance_marks TO school_app;
GRANT SELECT,INSERT ON attendance_corrections TO school_app;
