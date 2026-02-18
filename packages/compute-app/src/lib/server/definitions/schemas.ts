import { z } from 'zod';

/** UUID v4 regex */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GuidSchema = z.string().regex(UUID_REGEX, 'Invalid GUID format');

export const DefinitionMetadataSchema = z.object({
	displayName: z.string().min(1, 'Display name is required'),
	description: z.string().optional(),
	coverImage: z.string().optional(),
	category: z.string().optional(),
	tags: z.array(z.string()).optional(),
	file: z.string().optional()
});

/** Input for creating a new definition — validates metadata fields only (file binary handled separately) */
export const CreateDefinitionInputSchema = DefinitionMetadataSchema.omit({ file: true }).extend({
	displayName: z.string().min(1, 'Display name is required')
});

/** Partial patch for updating an existing definition */
export const UpdateMetadataInputSchema = DefinitionMetadataSchema.omit({ file: true }).partial();

export type CreateDefinitionMetadata = z.infer<typeof CreateDefinitionInputSchema>;
export type UpdateMetadataInput = z.infer<typeof UpdateMetadataInputSchema>;
