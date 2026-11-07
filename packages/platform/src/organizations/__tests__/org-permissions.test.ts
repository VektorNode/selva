import { describe, expect, it } from 'vitest';
import { MEMBER_ASSIGNABLE_PERMISSIONS } from '../schemas.js';

describe('MEMBER_ASSIGNABLE_PERMISSIONS', () => {
	it.each(['manage_org_members', 'manage_org_compute'] as const)(
		'never offers %s',
		(permission) => {
			expect(MEMBER_ASSIGNABLE_PERMISSIONS).not.toContain(permission);
		}
	);
});
