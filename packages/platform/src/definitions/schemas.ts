import { z } from 'zod';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Load-bearing beyond format: the stores index plain objects by guid, so this
// regex is what keeps `__proto__` and `constructor` out of a key position.
// Relaxing it to a looser string re-opens prototype pollution in every store
// that does `config.definitions[guid]`.
//
// Lowercases because local keys by raw string while Postgres compares `uuid`
// columns case-insensitively, so one GUID in two cases is two records on local.
export const GuidSchema = z.string().toLowerCase().regex(UUID_REGEX, 'Invalid GUID format');

/** A Grasshopper document GUID as stores keep and compare it (lowercase), or null for anything else. */
export function toSourceDocumentId(value: unknown): string | null {
	return typeof value === 'string' && UUID_REGEX.test(value) ? value.toLowerCase() : null;
}

// Leaves out `pending`, which `DefinitionStatus` adds: the create path writes it while
// the first blob upload is in flight, and a client must never set it through an update.
export const DefinitionStatusSchema = z.enum(['draft', 'published', 'archived']);

export const DefinitionChannelSchema = z.enum(['live', 'draft']);
