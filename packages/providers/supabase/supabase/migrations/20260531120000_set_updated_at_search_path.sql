-- ============================================================================
-- Harden selva.set_updated_at() with an immutable search_path
--
-- The trigger function shipped in 20260425155514_selva_initial.sql had a
-- role-mutable search_path (Supabase linter 0011_function_search_path_mutable).
-- The body only touches `new` and `now()` — no schema-qualified objects — so
-- pinning search_path to empty closes the privilege-escalation vector without
-- changing behaviour. Triggers that reference this function are unaffected.
-- ============================================================================

alter function selva.set_updated_at() set search_path = '';
