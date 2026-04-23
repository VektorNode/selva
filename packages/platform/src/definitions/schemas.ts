import { z } from 'zod';

/** UUID v4 regex */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GuidSchema = z.string().regex(UUID_REGEX, 'Invalid GUID format');

export const DefinitionStatusSchema = z.enum(['draft', 'review', 'published', 'archived']);


/** User-facing metadata fields — display info only, no lifecycle state. */
export const DefinitionMetadataSchema = z.object({
	displayName: z.string().min(1, 'Display name is required').max(256),
	description: z.string().max(2000).optional(),
	coverImage: z.string().max(2048).optional(),
	category: z.string().max(128).optional(),
	tags: z.array(z.string().max(64)).max(20).optional()
});

/** Input for creating a new definition — metadata + routing, file binary handled separately. */
export const CreateDefinitionInputSchema = DefinitionMetadataSchema.extend({
	projectId: GuidSchema,
	computeServerId: GuidSchema.optional(),
	maxHistory: z.number().int().min(0).optional()
});

/** Partial patch for updating an existing definition. */
export const UpdateMetadataInputSchema = DefinitionMetadataSchema.extend({
	description: z
		.string()
		.max(2000)
		.nullish()
		.transform((v) => v ?? undefined),
	coverImage: z
		.string()
		.max(2048)
		.nullish()
		.transform((v) => v ?? undefined),
	category: z
		.string()
		.max(128)
		.nullish()
		.transform((v) => v ?? undefined),
	maxHistory: z
		.number()
		.int()
		.min(0)
		.nullish()
		.transform((v) => v ?? undefined),
	projectId: GuidSchema.optional(),
	computeServerId: GuidSchema.nullish().transform((v) => v ?? null),
	status: DefinitionStatusSchema.optional()
})
	.partial();

export type UpdateMetadataInput = z.infer<typeof UpdateMetadataInputSchema>;
