import { z } from 'zod';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GuidSchema = z.string().regex(UUID_REGEX, 'Invalid GUID format');

// Intentionally omits `pending` — the fourth real status (see `DefinitionStatus`
// in ./types.ts). `pending` is a create-internal state that `DefinitionService.create`
// writes during the metadata-first window; a client must never hand-set it through an
// update, so it is absent from this input validator by design, not by drift. (`review`
// was a dead fifth value dropped from the DB CHECK in migration 20260716120000 — audit D2.)
export const DefinitionStatusSchema = z.enum(['draft', 'published', 'archived']);

export const DefinitionFileExtSchema = z.enum(['gh', 'ghx']);

export const DefinitionVersionSchema = z.object({
	id: GuidSchema,
	definitionId: GuidSchema,
	versionNumber: z.number().int().min(1),
	fileExt: DefinitionFileExtSchema,
	fileKey: z.string().min(1),
	originalFilename: z.string().max(256).optional(),
	uploadedBy: z.string().min(1),
	uploadedAt: z.string(),
	changeNote: z.string().max(1000).optional(),
	// Cached compute-extracted UI schema. Structural correctness is validated by
	// Rhino.Compute at upload, not here — this only asserts it's an object.
	schema: z.record(z.string(), z.unknown()).optional(),
	schemaExtractedAt: z.string().optional()
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
	// L2 cache quota (R9): 0 = off, N = per-definition entry cap, null = inherit
	// the global default. Bounded so a settings typo can't request a runaway quota.
	solveCacheLimit: z.number().int().min(0).max(100_000).nullable().optional(),
	status: DefinitionStatusSchema.optional()
});

export type UpdateMetadataInput = z.infer<typeof UpdateMetadataInputSchema>;

/** Body for `POST /api/definitions/[guid]/publish`. */
export const PublishVersionInputSchema = z
	.object({
		versionId: GuidSchema.optional()
	})
	.default({});
