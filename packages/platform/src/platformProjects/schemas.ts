import { z } from 'zod';

export const PlatformProjectGranteeTypeSchema = z.enum(['org', 'user']);

export const PlatformProjectGrantSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	granteeType: PlatformProjectGranteeTypeSchema,
	granteeId: z.string(),
	canSolve: z.boolean(),
	createdBy: z.string(),
	createdAt: z.string()
});
