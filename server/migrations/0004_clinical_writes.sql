-- Additive only: existing clinical values and relationships remain unchanged.
SET LOCAL lock_timeout = '5s';
ALTER TABLE nina_clinic.contacts ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE nina_clinic.animals ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE nina_clinic.appointments ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE nina_clinic.procedures ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);

CREATE FUNCTION nina_clinic.can_write(admin_only boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
 SELECT EXISTS (SELECT 1 FROM nina_auth.users u JOIN nina_auth.user_roles r ON r.user_id = u.id
 WHERE u.id = nullif(current_setting('nina.user_id', true), '')::uuid
 AND u.disabled_at IS NULL AND (r.role = 'admin' OR (NOT admin_only AND r.role = 'user')))
$$;
REVOKE ALL ON FUNCTION nina_clinic.can_write(boolean) FROM PUBLIC;

CREATE FUNCTION nina_clinic.bump_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
 NEW.revision := OLD.revision + 1;
 NEW.updated_at := clock_timestamp();
 RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION nina_clinic.bump_revision() FROM PUBLIC;

DO $$
DECLARE t text; predicate text;
BEGIN
 FOREACH t IN ARRAY ARRAY['contacts','animals','appointments','procedures'] LOOP
  predicate := CASE WHEN t = 'procedures' THEN 'nina_clinic.can_write(true)' ELSE 'nina_clinic.can_write(false)' END;
  EXECUTE format('CREATE POLICY staff_insert ON nina_clinic.%I FOR INSERT WITH CHECK (%s)', t, predicate);
  EXECUTE format('CREATE POLICY staff_update ON nina_clinic.%I FOR UPDATE USING (%s) WITH CHECK (%s)', t, predicate, predicate);
  EXECUTE format('CREATE TRIGGER bump_revision BEFORE UPDATE ON nina_clinic.%I FOR EACH ROW EXECUTE FUNCTION nina_clinic.bump_revision()', t);
 END LOOP;
END $$;

-- Audit stores field names, never the clinical values or request bodies.
CREATE TABLE nina_clinic.change_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES nina_auth.users(id),
 entity_type text NOT NULL CHECK (entity_type IN ('contacts','animals','appointments','procedures')),
 entity_id uuid NOT NULL,
 action text NOT NULL CHECK (action IN ('create','update')),
 changed_fields text[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_log_entity_idx ON nina_clinic.change_log(entity_type,entity_id,created_at);
ALTER TABLE nina_clinic.change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON nina_clinic.change_log FOR INSERT WITH CHECK (
 actor_id = nullif(current_setting('nina.user_id',true),'')::uuid AND nina_clinic.can_write(false)
);

-- A retry of an already committed operation returns its original id/revision.
CREATE TABLE nina_clinic.write_receipts (
 actor_id uuid NOT NULL REFERENCES nina_auth.users(id),
 operation_id uuid NOT NULL,
 fingerprint char(64) NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id, operation_id)
);
ALTER TABLE nina_clinic.write_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_receipt_read ON nina_clinic.write_receipts FOR SELECT USING (
 actor_id = nullif(current_setting('nina.user_id',true),'')::uuid AND nina_clinic.can_write(false)
);
CREATE POLICY own_receipt_insert ON nina_clinic.write_receipts FOR INSERT WITH CHECK (
 actor_id = nullif(current_setting('nina.user_id',true),'')::uuid AND nina_clinic.can_write(false)
);
REVOKE ALL ON nina_clinic.change_log, nina_clinic.write_receipts FROM PUBLIC;
