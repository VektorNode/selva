import { z } from 'zod';
import { DefinitionStatusSchema, GuidSchema } from './schemas.js';

/** HTTP-body validator for new-definition input. */
export const CreateDefinitionInputSchema = z.object({
	displayName: z.string().trim().min(1, 'Display name is required').max(256),
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
	displayName: z.string().trim().min(1, 'Display name is required').max(256).optional(),
	description: z.string().max(2000).nullable().optional(),
	coverImage: z.string().max(2048).nullable().optional(),
	category: z.string().max(128).nullable().optional(),
	tags: z.array(z.string().max(64)).max(20).nullable().optional(),
	projectId: GuidSchema.optional(),
	computeServerId: GuidSchema.nullable().optional(),
	// Bounded so a settings typo can't request a runaway quota.
	solveCacheLimit: z.number().int().min(0).max(100_000).nullable().optional(),
	status: DefinitionStatusSchema.optional()
});

export type UpdateMetadataInput = z.infer<typeof UpdateMetadataInputSchema>;

/** Body for publishing a version; without `versionId`, the current draft goes live. */
export const PublishVersionInputSchema = z
	.object({
		versionId: GuidSchema.optional()
	})
	.default({});
