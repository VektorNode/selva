import { z } from 'zod';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GuidSchema = z.string().regex(UUID_REGEX, 'Invalid GUID format');

export const DefinitionStatusSchema = z.enum(['draft', 'published']);

export const DefinitionFileExtSchema = z.enum(['gh', 'ghx']);

export const DefinitionVersionSchema = z.object({
	id: GuidSchema,
	definitionId: GuidSchema,
	versionNumber: z.number().int().min(1),
	fileExt: DefinitionFileExtSchema,
	fileKey: z.string().min(1),
	originalFilename: z.string().max(256).optional(),
	uploadedBy: z.string().min(1),
	uploadedAt: z.string()
});

export const DefinitionChannelSchema = z.enum(['live', 'draft']);

/** HTTP-body validator for new-definition input. */
export const CreateDefinitionInputSchema = z.object({
	displayName: z.string().min(1, 'Display name is required').max(256),
	description: z.string().max(2000).optional(),
	coverImage: z.string().max(2048).optional(),
	category: z.string().max(128).optional(),
	tags: z.array(z.string().max(64)).max(20).optional(),
	projectId: GuidSchema,
	computeServerId: GuidSchema.optional()
});

/**
 * PATCH validator. Field semantics match `DefinitionRecordPatch`:
 * - missing / `undefined` — leave unchanged
 * - `null` — clear (only on nullable fields)
 * - value — set
 */
export const UpdateMetadataInputSchema = z.object({
	displayName: z.string().min(1, 'Display name is required').max(256).optional(),
	description: z.string().max(2000).nullable().optional(),
	coverImage: z.string().max(2048).nullable().optional(),
	category: z.string().max(128).nullable().optional(),
	tags: z.array(z.string().max(64)).max(20).nullable().optional(),
	projectId: GuidSchema.optional(),
	computeServerId: GuidSchema.nullable().optional(),
	status: DefinitionStatusSchema.optional()
});

export type UpdateMetadataInput = z.infer<typeof UpdateMetadataInputSchema>;

/** Body for `POST /api/definitions/[guid]/publish`. */
export const PublishVersionInputSchema = z
	.object({
		versionId: GuidSchema.optional()
	})
	.default({});
