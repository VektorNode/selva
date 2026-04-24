import { z } from 'zod';
import { OrgRoleSchema, OrgPermissionSchema } from '../organizations/schemas.js';

export const CreateInviteInputSchema = z.object({
	email: z
		.string()
		.email('Valid email is required')
		.transform((s) => s.toLowerCase()),
	orgId: z.string().uuid(),
	orgRole: OrgRoleSchema,
	orgPermissions: z.array(OrgPermissionSchema).default([])
});

export const AcceptInviteInputSchema = z.object({
	token: z.string().min(20),
	password: z.string().min(8, 'Password must be at least 8 characters'),
	displayName: z.string().trim().max(128).optional()
});

export type CreateInviteInput = z.infer<typeof CreateInviteInputSchema>;
export type AcceptInviteInput = z.infer<typeof AcceptInviteInputSchema>;
