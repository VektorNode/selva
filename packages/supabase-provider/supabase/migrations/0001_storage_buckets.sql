-- Storage policies for the Selva buckets.
--
-- Phase 1 (storage-only): the conformance tests run with the service-role
-- client so they bypass RLS by design. These policies govern user-facing
-- access once the app wires the user-scoped client.
--
-- selva-public:
--   - Anyone (anon + authenticated) can read.
--   - Only authenticated users can write/delete.
--
-- selva-private:
--   - Only authenticated users can read/write/delete. Application-level
--     checks (handled by the SvelteKit /api/files route) layer on top —
--     "authenticated" is necessary but not sufficient once we have
--     definition-level visibility in place.
--
-- Service-role requests bypass these entirely — that's what the admin
-- paths and the conformance suite rely on.

-- ── selva-public ──────────────────────────────────────────────────────────
create policy "selva-public: anyone can read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'selva-public');

create policy "selva-public: authenticated can write"
on storage.objects for insert
to authenticated
with check (bucket_id = 'selva-public');

create policy "selva-public: authenticated can update"
on storage.objects for update
to authenticated
using (bucket_id = 'selva-public')
with check (bucket_id = 'selva-public');

create policy "selva-public: authenticated can delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'selva-public');

-- ── selva-private ─────────────────────────────────────────────────────────
create policy "selva-private: authenticated can read"
on storage.objects for select
to authenticated
using (bucket_id = 'selva-private');

create policy "selva-private: authenticated can write"
on storage.objects for insert
to authenticated
with check (bucket_id = 'selva-private');

create policy "selva-private: authenticated can update"
on storage.objects for update
to authenticated
using (bucket_id = 'selva-private')
with check (bucket_id = 'selva-private');

create policy "selva-private: authenticated can delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'selva-private');
