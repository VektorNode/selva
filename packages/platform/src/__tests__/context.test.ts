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

const user = (over: Partial<RequestContext>): RequestContext => ({
	userId: 'u',
	actingOrgId: 'acme',
	platformPermissions: [],
	orgPermissions: [],
	...over
});

describe('hasPermission', () => {
	it('gives a share context nothing, though it runs as system', () => {
		expect(hasPermission(share, 'instance_admin')).toBe(false);
		expect(hasPermission(share, 'manage_org_members')).toBe(false);
	});

	it('gives a share context nothing even when permissions leaked onto it', () => {
		const leaked = { ...share, platformPermissions: [...SYSTEM_CONTEXT.platformPermissions] };
		expect(hasPermission(leaked, 'instance_admin')).toBe(false);
		expect(
			hasPermission({ ...share, orgPermissions: ['manage_projects'] }, 'manage_projects')
		).toBe(false);
	});

	it('gives a real system context everything', () => {
		expect(hasPermission(SYSTEM_CONTEXT, 'instance_admin')).toBe(true);
	});

	it('lets instance_admin imply every org permission', () => {
		expect(
			hasPermission(user({ platformPermissions: ['instance_admin'] }), 'manage_org_members')
		).toBe(true);
	});

	it('keeps platform and org permissions apart', () => {
		const orgAdmin = user({ orgPermissions: ['manage_org_compute'] });
		expect(hasPermission(orgAdmin, 'manage_org_compute')).toBe(true);
		expect(hasPermission(orgAdmin, 'manage_compute')).toBe(false);
		expect(
			hasPermission(user({ platformPermissions: ['manage_compute'] }), 'manage_org_compute')
		).toBe(false);
	});
});
