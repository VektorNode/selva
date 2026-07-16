-- ============================================================================
-- User-erasure helper: redact an email out of invite.created audit payloads
-- (audit P1)
-- ============================================================================
--
-- `invite.created` domain events embed the invitee's email in the audit
-- payload (`data->>'email'`). Those rows are authored by the INVITER, so on the
-- invitee's erasure the row must survive (it records the inviter's action) but
-- the invitee's email must be scrubbed. This function redacts the `email` key
-- in place for every matching row, in one statement.
--
-- SECURITY DEFINER so `onUserDeleted` can call it through the service-role
-- client without granting the caller direct UPDATE on audit_events. Scoped to
-- `type = 'invite.created'` — the only event shape that carries an email.

create or replace function selva.redact_audit_event_email(p_email text)
returns integer
language plpgsql
security definer
set search_path = selva, pg_temp
as $$
declare
	affected integer;
begin
	update selva.audit_events
	set data = jsonb_set(data, '{email}', '"[erased]"'::jsonb)
	where type = 'invite.created'
	  and data->>'email' = p_email;
	get diagnostics affected = row_count;
	return affected;
end;
$$;

comment on function selva.redact_audit_event_email(text) is
	'Redacts an invitee email out of invite.created audit payloads on user '
	'erasure (audit P1). Returns the number of rows redacted.';
