import { z } from 'zod';
import { DefinitionChannelSchema } from '../definitions/schemas.js';

/** HTTP body for minting a share link. */
export const CreateShareLinkInputSchema = z.object({
	channel: DefinitionChannelSchema.default('live'),
	name: z.string().max(128).optional(),
	allowSolve: z.boolean().default(true),
	/**
	 * Null is the minter's deliberate "uncap" choice. Omitted stays undefined here:
	 * the mint handler applies `DEFAULT_SHARE_LINK_MAX_SOLVES`.
	 */
	maxSolves: z.number().int().min(1).nullable().optional(),
	expiresAt: z.iso.datetime().nullable().optional()
});

export type CreateShareLinkInput = z.infer<typeof CreateShareLinkInputSchema>;
