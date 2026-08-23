import { z } from 'zod';
import { DefinitionChannelSchema } from '../definitions/schemas.js';

/**
 * HTTP body for `POST /api/definitions/[guid]/share-links`. The route returns
 * the raw token exactly once.
 */
export const CreateShareLinkInputSchema = z.object({
	channel: DefinitionChannelSchema.default('live'),
	name: z.string().max(128).optional(),
	allowSolve: z.boolean().default(true),
	/** Null is the minter's deliberate "uncap" choice; omitted applies the default cap. */
	maxSolves: z.number().int().min(1).nullable().optional(),
	expiresAt: z.iso.datetime().nullable().optional()
});

export type CreateShareLinkInput = z.infer<typeof CreateShareLinkInputSchema>;
