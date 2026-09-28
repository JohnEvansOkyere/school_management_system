CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE command_receipts (
  school_id uuid NOT NULL REFERENCES schools(id),id uuid NOT NULL,actor_membership_id uuid NOT NULL,
  action text NOT NULL,payload_digest text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(school_id,id),FOREIGN KEY(school_id,actor_membership_id) REFERENCES memberships(school_id,id)
);
CREATE TABLE academic_years (
  id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),name text NOT NULL,
  start_date date NOT NULL,end_date date NOT NULL,CHECK(start_date<end_date),UNIQUE(school_id,id),UNIQUE(school_id,name)
);
CREATE TABLE class_sections (
  id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),academic_year_id uuid NOT NULL,
  name text NOT NULL,level text NOT NULL CHECK(level IN ('Nursery','KG','Primary','JHS')),
  capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 500),UNIQUE(school_id,id),UNIQUE(school_id,academic_year_id,name),
  FOREIGN KEY(school_id,academic_year_id) REFERENCES academic_years(school_id,id)
);
CREATE TABLE learners (
  id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),admission_number text NOT NULL,
  full_name text NOT NULL,date_of_birth date,version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(school_id,id),UNIQUE(school_id,admission_number)
);
CREATE TABLE admissions (
  id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),full_name text NOT NULL,date_of_birth date,
  class_id uuid NOT NULL,start_date date NOT NULL,admission_number text NOT NULL,
  status text NOT NULL DEFAULT 'application' CHECK(status IN ('application','review','offered','waitlisted','declined','accepted','enrolled')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),learner_id uuid,decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(school_id,id),UNIQUE(school_id,admission_number),
  FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id),
  CHECK((status='enrolled')=(learner_id IS NOT NULL))
);
CREATE TABLE enrolments (
  id uuid PRIMARY KEY,school_id uuid NOT NULL REFERENCES schools(id),learner_id uuid NOT NULL,class_id uuid NOT NULL,
  start_date date NOT NULL,end_date date,end_reason text,created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id),FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id),
  FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),
  CHECK(end_date IS NULL OR end_date>start_date),CHECK((end_date IS NULL)=(end_reason IS NULL)),
  EXCLUDE USING gist(school_id WITH =,learner_id WITH =,daterange(start_date,end_date,'[)') WITH &&)
);
CREATE INDEX enrolment_class_dates ON enrolments(school_id,class_id,start_date,end_date);
CREATE INDEX admissions_school_status ON admissions(school_id,status,created_at);
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['command_receipts','academic_years','class_sections','learners','admissions','enrolments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY school_context ON %I USING(school_id::text=current_setting(''app.school_id'',true)) WITH CHECK(school_id::text=current_setting(''app.school_id'',true))',table_name);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON command_receipts,academic_years,class_sections,learners,admissions,enrolments TO school_app;
GRANT UPDATE(version) ON learners TO school_app;
GRANT UPDATE(capacity) ON class_sections TO school_app;
GRANT UPDATE(status,version,learner_id,decision_reason) ON admissions TO school_app;
GRANT UPDATE(end_date,end_reason) ON enrolments TO school_app;
CREATE FUNCTION preserve_closed_enrolment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.end_date IS NOT NULL AND (NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.end_reason IS DISTINCT FROM OLD.end_reason) THEN
    RAISE EXCEPTION 'Closed enrolment history is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER closed_enrolment_immutable BEFORE UPDATE ON enrolments FOR EACH ROW EXECUTE FUNCTION preserve_closed_enrolment();
