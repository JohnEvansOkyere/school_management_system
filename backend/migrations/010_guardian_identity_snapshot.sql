ALTER TABLE guardian_links ADD COLUMN guardian_display_name text;
ALTER TABLE guardian_links DISABLE TRIGGER guardian_history_immutable;
UPDATE guardian_links g SET guardian_display_name=u.display_name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.school_id=g.school_id AND m.id=g.guardian_membership_id;
ALTER TABLE guardian_links ENABLE TRIGGER guardian_history_immutable;
ALTER TABLE guardian_links ALTER COLUMN guardian_display_name SET NOT NULL;
CREATE OR REPLACE FUNCTION preserve_guardian_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.school_id,NEW.learner_id,NEW.guardian_membership_id,NEW.guardian_display_name,NEW.academic,NEW.billing,NEW.pickup,NEW.contact,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.learner_id,OLD.guardian_membership_id,OLD.guardian_display_name,OLD.academic,OLD.billing,OLD.pickup,OLD.contact,OLD.created_at) OR
    OLD.revoked_at IS NOT NULL OR
    (OLD.verified_at IS NOT NULL AND (NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verification_reason IS DISTINCT FROM OLD.verification_reason)) THEN
    RAISE EXCEPTION 'Guardian rights, identity and review history is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
