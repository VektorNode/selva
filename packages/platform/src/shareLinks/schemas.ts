import { z } from 'zod';
import { DefinitionChannelSchema } from '../definitions/schemas.js';

/**
 * HTTP body for `POST /api/definitions/[guid]/share-links`. The route returns
 * the raw token exactly once; subsequent reads only expose `hasToken` style
 * metadata.
 */
export const CreateShareLinkInputSchema = z.object({
	channel: DefinitionChannelSchema.default('live'),
	name: z.string().max(128).optional(),
	allowSolve: z.boolean().default(true),
	/**
	 * Null explicitly removes the cap. Omitted = apply default. The route
	 * applies `DEFAULT_SHARE_LINK_MAX_SOLVES` only when this field is absent
	 * — null is the manager's deliberate "uncap" choice.
	 */
	maxSolves: z.number().int().min(1).nullable().optional(),
	/**
	 * Optional ISO timestamp. Stored as-is; resolution compares to `now()`.
	 * The default-cap rationale doesn't apply to expiry — opt-in only.
	 */
	expiresAt: z.iso.datetime().nullable().optional()
});

export type CreateShareLinkInput = z.infer<typeof CreateShareLinkInputSchema>;
