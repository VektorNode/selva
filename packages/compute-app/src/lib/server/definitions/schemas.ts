import { z } from 'zod';

/** UUID v4 regex */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GuidSchema = z.string().regex(UUID_REGEX, 'Invalid GUID format');

export const DefinitionMetadataSchema = z.object({
	displayName: z.string().min(1, 'Display name is required').max(256),
	description: z.string().max(2000).optional(),
	coverImage: z.string().max(2048).optional(),
	category: z.string().max(128).optional(),
	tags: z.array(z.string().max(64)).max(20).optional(),
	author: z.string().max(128).optional(),
	lastUpdated: z.date().optional(),
	file: z.string().optional()
});

/** Input for creating a new definition — validates metadata fields only (file binary handled separately) */
export const CreateDefinitionInputSchema = DefinitionMetadataSchema.omit({ file: true }).extend({
	displayName: z.string().min(1, 'Display name is required')
});

/** Partial patch for updating an existing definition.
 * Uses nullish() on string fields so null values (e.g. from manual config edits) are
 * coerced to undefined instead of failing validation. */
export const UpdateMetadataInputSchema = DefinitionMetadataSchema.omit({ file: true, lastUpdated: true }).extend({
	description: z.string().max(2000).nullish().transform((v) => v ?? undefined),
	coverImage: z.string().max(2048).nullish().transform((v) => v ?? undefined),
	category: z.string().max(128).nullish().transform((v) => v ?? undefined),
	author: z.string().max(128).nullish().transform((v) => v ?? undefined)
}).partial();

export type CreateDefinitionMetadata = z.infer<typeof CreateDefinitionInputSchema>;
export type UpdateMetadataInput = z.infer<typeof UpdateMetadataInputSchema>;
