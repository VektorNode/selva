-- ============================================================================
-- selva.compute_servers.has_api_key — key presence without reading the key (audit 4b)
-- ============================================================================
--
-- Every solve resolves one compute server, but the store's only read was
-- `getConfig`, which selected `api_key` for EVERY row and decrypted each one on
-- the way out — N decrypts of secrets the solve path throws away, to use one.
--
-- The keys could not simply be dropped from the projection because the admin and
-- org compute pages render a "key is set" state, which was derived as `!!apiKey`
-- and so needed the plaintext. This generated column answers that question from
-- the ciphertext's presence alone, so the default projection can omit `api_key`
-- entirely: no secret leaves the database to decide whether a badge renders.
--
-- STORED (not a view or an expression index) because it is read on the same
-- projection as every other column and costs a byte per row.

alter table selva.compute_servers
	add column if not exists has_api_key boolean
	generated always as (api_key is not null and api_key <> '') stored;
