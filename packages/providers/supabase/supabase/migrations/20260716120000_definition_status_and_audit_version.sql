-- ============================================================================
-- Definition-status enum cleanup (audit D2) + audit-event versioning (audit D3)
-- ============================================================================

-- D2. The definition-status CHECK admitted five values, but only four are real:
--   pending   — metadata-first create window (DefinitionService.create writes it,
--               a partial reclaim index tracks it). REAL — kept.
--   draft     — work in progress.                                     REAL — kept.
--   published — live.                                                 REAL — kept.
--   archived  — retired but preserved.                                REAL — kept.
--   review    — never written or read anywhere in the codebase.       DEAD — dropped.
-- Dropping `review` while the table holds no such rows is a zero-row change; do
-- it now, while it is a one-line CHECK swap rather than a data migration later.
-- (Postgres has no "alter check" — drop the old constraint and add the new one.
-- The constraint name is the Postgres-generated default `definitions_status_check`.)

alter table selva.definitions
	drop constraint if exists definitions_status_check;

alter table selva.definitions
	add constraint definitions_status_check
	check (status in ('pending', 'draft', 'published', 'archived'));

-- D3. `audit_events` is append-only forever: every row written before a version
-- marker exists is a row whose payload shape must be inferred later. Add an
-- explicit `event_version` column now so the `data` envelope carries its schema
-- version out of band. Existing rows are the v1 shape by definition, so default
-- + backfill to 1; NOT NULL once populated.

alter table selva.audit_events
	add column if not exists event_version integer not null default 1;

comment on column selva.audit_events.event_version is
	'Schema version of the `data` payload (the DomainEvent envelope). Bump when '
	'the persisted shape changes so readers can dispatch on version instead of '
	'inferring it. v1 = the initial DomainEvent union.';
