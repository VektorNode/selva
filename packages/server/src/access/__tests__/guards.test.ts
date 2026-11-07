import { describe, it, expect } from 'vitest';
import {
	narrowApiTokenContext,
	type PlatformPermission,
	type RequestContext
} from '@selvajs/platform';
import { assertCanGrantPlatformPermissions, requireActingOrg } from '../guards.js';
import { ApiError } from '../../api/errors.js';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function session(platformPermissions: PlatformPermission[] = []): RequestContext {
	return {
		userId: 'u1',
		actingOrgId: ORG_A,
		platformPermissions,
		orgPermissions: ['manage_org_members']
	};
}

function keyIn(orgId: string): RequestContext {
	return narrowApiTokenContext(
		{ ...session(), actingOrgId: orgId },
		{ id: 'key-1', orgId, scopes: ['write:all'], expiresAt: '2099-01-01T00:00:00.000Z' }
	);
}

function refusal(fn: () => unknown): ApiError {
	try {
		fn();
	} catch (err) {
		if (err instanceof ApiError) return err;
		throw err;
	}
	throw new Error('expected the guard to refuse');
}

describe('requireActingOrg', () => {
	it('passes the org the request acts in', () => {
		expect(requireActingOrg({ ctx: session() }, ORG_A).orgId).toBe(ORG_A);
	});

	it('refuses a session acting in one org that names another, though it may belong to both', () => {
		expect(refusal(() => requireActingOrg({ ctx: session() }, ORG_B))).toMatchObject({
			status: 403,
			code: 'FORBIDDEN',
			message: 'Acting org does not match the target org.'
		});
	});

	it('refuses an API key naming an org other than its own', () => {
		expect(refusal(() => requireActingOrg({ ctx: keyIn(ORG_A) }, ORG_B))).toMatchObject({
			status: 403,
			code: 'FORBIDDEN'
		});
		expect(requireActingOrg({ ctx: keyIn(ORG_A) }, ORG_A).orgId).toBe(ORG_A);
	});

	it('refuses a caller acting in no org rather than letting the URL pick one', () => {
		const ctx = { ...session(), actingOrgId: undefined };
		expect(refusal(() => requireActingOrg({ ctx }, ORG_A))).toMatchObject({ status: 400 });
	});

	it('refuses an anonymous caller and a missing org id', () => {
		expect(refusal(() => requireActingOrg({}, ORG_A))).toMatchObject({ status: 401 });
		expect(refusal(() => requireActingOrg({ ctx: session() }, undefined))).toMatchObject({
			status: 400
		});
	});
});

// Called alone: the stores refuse some revocations themselves (the last
// `instance_admin`), so a route test can pass on the store's refusal.
describe('assertCanGrantPlatformPermissions', () => {
	const userAdmin = session(['manage_instance_users']);
	const instanceAdmin = session(['instance_admin']);

	it('refuses removing a permission the caller does not hold', () => {
		expect(
			refusal(() => assertCanGrantPlatformPermissions(userAdmin, [], ['manage_updates']))
		).toMatchObject({
			status: 403,
			code: 'FORBIDDEN',
			message: 'Only a platform admin can change platform-scope permissions'
		});
	});

	it('refuses removing one of several, keeping the rest', () => {
		expect(
			refusal(() =>
				assertCanGrantPlatformPermissions(
					userAdmin,
					['manage_compute'],
					['manage_compute', 'instance_admin']
				)
			)
		).toMatchObject({ status: 403 });
	});

	it('refuses adding a permission the caller does not hold, on create and on update', () => {
		expect(
			refusal(() => assertCanGrantPlatformPermissions(userAdmin, ['manage_updates']))
		).toMatchObject({
			status: 403,
			message: 'Only a platform admin can grant platform-scope permissions'
		});
		expect(
			refusal(() => assertCanGrantPlatformPermissions(userAdmin, ['manage_updates'], []))
		).toMatchObject({ status: 403 });
	});

	it('refuses granting even a permission the caller holds: platform scope is not delegable', () => {
		expect(
			refusal(() => assertCanGrantPlatformPermissions(userAdmin, ['manage_instance_users'], []))
		).toMatchObject({ status: 403 });
	});

	it('lets anyone resubmit the current set unchanged, in any order', () => {
		expect(() =>
			assertCanGrantPlatformPermissions(
				userAdmin,
				['manage_updates', 'manage_compute'],
				['manage_compute', 'manage_updates']
			)
		).not.toThrow();
		expect(() => assertCanGrantPlatformPermissions(userAdmin, [])).not.toThrow();
	});

	it('lets instance_admin add and remove', () => {
		expect(() =>
			assertCanGrantPlatformPermissions(instanceAdmin, ['manage_updates'], [])
		).not.toThrow();
		expect(() =>
			assertCanGrantPlatformPermissions(instanceAdmin, [], ['instance_admin'])
		).not.toThrow();
		expect(() =>
			assertCanGrantPlatformPermissions(instanceAdmin, ['instance_admin'])
		).not.toThrow();
	});

	it('does not let an API key carry its owner’s instance_admin into a grant', () => {
		const key = narrowApiTokenContext(instanceAdmin, {
			id: 'key-1',
			orgId: ORG_A,
			scopes: ['write:all'],
			expiresAt: '2099-01-01T00:00:00.000Z'
		});
		expect(
			refusal(() => assertCanGrantPlatformPermissions(key, ['manage_updates'], []))
		).toMatchObject({ status: 403 });
	});
});
