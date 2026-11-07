/**
 * Every `/api/admin/*` handler, called as each kind of caller that must not
 * pass it. The hook only checks for a session here; each handler's own guard is
 * the whole of its authorization, and a guard naming the wrong platform
 * permission still reads as "guarded" to a source check.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PlatformPermission } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedUser,
	seedOrgMember,
	actAs,
	anon,
	call,
	silentLog,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';

type Handler = Parameters<typeof call>[0];
type RouteModule = Partial<Record<(typeof METHODS)[number], Handler>>;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** From the admin API table in docs/contributing/permissions.md. */
const REQUIRED: Record<string, PlatformPermission> = {
	users: 'manage_instance_users',
	'users/[id]': 'manage_instance_users',
	'users/[id]/disable': 'manage_instance_users',
	compute: 'manage_compute',
	'compute/status': 'manage_compute',
	'compute/actions': 'manage_compute',
	'system/update': 'instance_admin',
	'system/health': 'instance_admin',
	'system/throughput': 'instance_admin',
	orgs: 'instance_admin',
	'orgs/[id]': 'instance_admin',
	projects: 'instance_admin',
	'projects/[id]': 'instance_admin',
	'projects/[id]/grants': 'instance_admin',
	'projects/[id]/grants/[grantId]': 'instance_admin'
};

/** Every platform permission short of `instance_admin`, which implies the rest. */
const NARROW: PlatformPermission[] = [
	'manage_compute',
	'manage_instance_users',
	'manage_updates',
	'manage_api_tokens'
];

const modules = import.meta.glob<RouteModule>('../**/+server.ts', { eager: true });

const routes = Object.entries(modules).map(([file, mod]) => ({
	path: file.replace(/^\.\.\//, '').replace(/\/\+server\.ts$/, ''),
	mod
}));

const handlers = routes.flatMap(({ path, mod }) =>
	METHODS.filter((m) => mod[m]).map((method) => ({
		name: `${method} /api/admin/${path}`,
		path,
		method,
		handler: mod[method]!
	}))
);

/** A value for each `[param]`: nothing exists behind it, so a passing guard can only reach a 4xx. */
function paramsFor(path: string): Record<string, string> {
	return Object.fromEntries(
		[...path.matchAll(/\[(\w+)\]/g)].map(([, name]) => [name, `no-such-${name}`])
	);
}

let tp: TestProviders;
const callers = new Map<string, unknown>();

beforeAll(async () => {
	tp = await freshProviders({ flags: { ENABLE_PLATFORM_PROJECTS: true } });
	const { acme, bob } = await seedAcme(tp);
	callers.set('anonymous', { ...anon(tp), log: silentLog });
	callers.set('member', await actAs(tp, bob.id));
	for (const permission of NARROW) {
		const user = await seedUser(tp, `${permission}@acme.test`, [permission]);
		await seedOrgMember(tp, { orgId: acme.id, userId: user.id, role: 'member' });
		callers.set(permission, await actAs(tp, user.id));
	}
});

afterAll(() => tp.cleanup());

function invoke(entry: (typeof handlers)[number], caller: string) {
	const writes = entry.method !== 'GET' && entry.method !== 'DELETE';
	return call(entry.handler, {
		locals: callers.get(caller),
		method: entry.method,
		params: paramsFor(entry.path),
		body: writes ? {} : undefined
	});
}

describe('admin API guards', () => {
	it('found the admin routes, and each has a required permission on record', () => {
		expect(handlers.length).toBeGreaterThan(20);
		expect(routes.map((r) => r.path).sort()).toEqual(Object.keys(REQUIRED).sort());
	});

	it.each(handlers)('$name refuses an anonymous caller with 401', async (entry) => {
		expect((await invoke(entry, 'anonymous')).status).toBe(401);
	});

	it.each(handlers)('$name refuses a plain org member with 403', async (entry) => {
		expect((await invoke(entry, 'member')).status).toBe(403);
	});

	it.each(handlers)('$name admits only its own platform permission', async (entry) => {
		const required = REQUIRED[entry.path];
		for (const permission of NARROW) {
			const { status } = await invoke(entry, permission);
			if (permission === required) {
				expect([401, 403], `${permission} should pass the guard`).not.toContain(status);
			} else {
				expect(status, `${permission} should be refused`).toBe(403);
			}
		}
	});
});
