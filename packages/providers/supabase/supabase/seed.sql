-- Seed SQL applied after migrations on `npx supabase db reset`.
--
-- Phase 1 (storage-only): create the two buckets the storage provider targets:
--   - selva-public: cover images, archive thumbnails, anything CDN-safe
--   - selva-private: .gh / .ghx source files, fetched via authenticated routes
--
-- Bucket creation has to be idempotent because seed runs on every reset.

insert into storage.buckets (id, name, public)
values
  ('selva-public', 'selva-public', true),
  ('selva-private', 'selva-private', false)
on conflict (id) do nothing;
