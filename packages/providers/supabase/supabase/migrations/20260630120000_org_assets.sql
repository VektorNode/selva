-- ============================================================================
-- Add org branding assets
--
-- A JSONB `assets` map on selva.orgs holds public URLs of the org's branding
-- assets, keyed by kind (`logo`, `favicon`, …) — e.g. {"logo": "https://…"}.
-- Each blob lives in the public storage bucket at `orgs/{id}/{kind}.webp`;
-- every upload (including SVG) is rasterized to WebP by the shared transcoder,
-- so no vector blob is ever stored and the served bytes carry no XSS surface.
--
-- One JSONB column instead of a column-per-asset: adding a new asset kind is an
-- app-layer enum change, never another migration.
--
-- No new RLS policy: the existing `orgs` UPDATE policy
-- (instance_admin or owner_id = auth.uid()) already governs every column on the
-- row; asset edits are additionally gated to `manage_org_members` at the app
-- layer.
-- ============================================================================

alter table selva.orgs add column if not exists assets jsonb not null default '{}'::jsonb;
