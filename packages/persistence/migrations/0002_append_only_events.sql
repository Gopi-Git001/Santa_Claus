-- Enforce the append-only event log in the database (INV-007, INV-018): the
-- application role cannot UPDATE, DELETE or TRUNCATE recorded events. Only a
-- privileged operator who explicitly disables the triggers could; that is a
-- deliberate, auditable act outside normal operation (threat model T9).

CREATE FUNCTION harness_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'harness_events is append-only (% rejected)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER harness_events_no_update_delete
  BEFORE UPDATE OR DELETE ON harness_events
  FOR EACH ROW EXECUTE FUNCTION harness_events_append_only();

CREATE TRIGGER harness_events_no_truncate
  BEFORE TRUNCATE ON harness_events
  FOR EACH STATEMENT EXECUTE FUNCTION harness_events_append_only();
