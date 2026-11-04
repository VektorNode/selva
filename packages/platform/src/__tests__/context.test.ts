import { describe, expect, it } from 'vitest';
import { hasPermission, SYSTEM_CONTEXT, type RequestContext } from '../context.js';

const share: RequestContext = {
	userId: 'share:l',
	actingOrgId: 'acme',
	platformPermissions: [],
	orgPermissions: [],
	system: true,
	shareLinkId: 'l'
};

describe('hasPermission', () => {
	it('gives a share context nothing, though it runs as system', () => {
		expect(hasPermission(share, 'instance_admin')).toBe(false);
		expect(hasPermission(share, 'manage_org_members')).toBe(false);
	});

	it('gives a real system context everything', () => {
		expect(hasPermission(SYSTEM_CONTEXT, 'instance_admin')).toBe(true);
	});
});
