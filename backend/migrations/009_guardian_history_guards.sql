ALTER TABLE guardian_links ADD CONSTRAINT guardian_verified_reason_required CHECK(verified_at IS NULL OR (verified_by IS NOT NULL AND verification_reason IS NOT NULL AND length(btrim(verification_reason))>=3));
ALTER TABLE guardian_links ADD CONSTRAINT guardian_revoked_reason_required CHECK(revoked_at IS NULL OR (revoked_by IS NOT NULL AND revocation_reason IS NOT NULL AND length(btrim(revocation_reason))>=3));
CREATE OR REPLACE FUNCTION preserve_guardian_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.school_id,NEW.learner_id,NEW.guardian_membership_id,NEW.academic,NEW.billing,NEW.pickup,NEW.contact,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.learner_id,OLD.guardian_membership_id,OLD.academic,OLD.billing,OLD.pickup,OLD.contact,OLD.created_at) OR
    OLD.revoked_at IS NOT NULL OR
    (OLD.verified_at IS NOT NULL AND (NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verification_reason IS DISTINCT FROM OLD.verification_reason)) THEN
    RAISE EXCEPTION 'Guardian rights, verification and revocation history is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
