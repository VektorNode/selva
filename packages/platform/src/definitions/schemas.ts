import { z } from 'zod';

/** UUID v4 regex */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GuidSchema = z.string().regex(UUID_REGEX, 'Invalid GUID format');

export const DefinitionStatusSchema = z.enum(['draft', 'review', 'published', 'archived']);

export const DefinitionFileExtSchema = z.enum(['gh', 'ghx']);

/**
 * Spec §6 DefinitionVersion. See definitions/types.ts for the runtime shape.
 */
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

/**
 * Spec §6 channel for solve dispatch.
 */
export const DefinitionChannelSchema = z.enum(['live', 'draft']);

/**
 * Input for creating a new definition — HTTP-body validator. Distinct from
 * `CreateDefinitionRecord` in `./service.ts`, which is the service-side type
 * with server-derived fields (guid, ownerId, fileExt) added.
 */
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
 * Partial patch for updating an existing definition.
 *
 * Field semantics (matches `DefinitionRecordPatch`):
 * - missing / `undefined` — leave unchanged
 * - `null` — clear the field (only the nullable fields below)
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
