import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	actAs,
	call,
	grantPlatformPermissions,
	sessionTokenFor,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { getBootHealth } from '#lib/server/bootHealth.server.js';
import { DELETE as deleteUser } from '../routes/api/admin/users/[id]/+server.js';
import { POST as disableUser } from '../routes/api/admin/users/[id]/disable/+server.js';
import { handle } from '../hooks.server';
import { hookEvent, mintApiKey, reached } from './hook-requests';

/**
 * A `selva_` key decides its request alone. These drive `handle` itself, because
 * the cookie fallback a refused key must never reach lives there, not in the resolver.
 */

let tp: TestProviders | null = null;

afterEach(async () => {
	// The first request kicks the boot health check; let it finish before its providers go.
	await getBootHealth();
	await tp?.cleanup();
	tp = null;
});

async function seeded() {
	tp = await freshProviders();
	const cast = await seedAcme(tp);
	await grantPlatformPermissions(tp, cast.alice.id, ['instance_admin']);
	return cast;
}

function withKey(path: string, raw: string, sessionOf?: string) {
	return hookEvent(path, {
		headers: { authorization: `Bearer ${raw}` },
		cookies: sessionOf ? { admin_session: sessionTokenFor(sessionOf) } : {}
	});
}

describe('a refused API key never falls back to the session cookie', () => {
	it('the session cookie on its own reaches the route', async () => {
		const { alice } = await seeded();
		const resolve = reached();
		const event = hookEvent('/api/admin/users', {
			cookies: { admin_session: sessionTokenFor(alice.id) }
		});

		const res = await handle({ event, resolve });

		expect(res.status).toBe(200);
		expect(event.locals.user?.id).toBe(alice.id);
	});

	it('a revoked key gets 401 with a valid session cookie alongside', async () => {
		const { alice, acme } = await seeded();
		const { raw, id } = await mintApiKey(tp!, alice.id, acme.id);
		await tp!.config.data.apiTokens!.revoke(SYSTEM_CONTEXT, id, 'owner');
		const resolve = reached();

		const res = await handle({ event: withKey('/api/v1/projects', raw, alice.id), resolve });

		expect(res.status).toBe(401);
		expect(res.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
		expect(resolve).not.toHaveBeenCalled();
	});

	it('an instance admin’s key is refused on /api/admin/* with their own session alongside', async () => {
		const { alice, acme } = await seeded();
		const { raw } = await mintApiKey(tp!, alice.id, acme.id);
		const resolve = reached();

		const res = await handle({ event: withKey('/api/admin/users', raw, alice.id), resolve });

		expect(res.status).toBe(403);
		expect(resolve).not.toHaveBeenCalled();
	});
});

describe('a key stops working on the next request once its owner is gone', () => {
	// The hook remembers a resolved key for a minute; these prove the admin
	// routes drop it from that memory rather than leaving it to expire.
	it('after the owner is disabled', async () => {
		const { alice, bob, acme } = await seeded();
		const { raw } = await mintApiKey(tp!, bob.id, acme.id);
		const first = await handle({ event: withKey('/api/v1/projects', raw), resolve: reached() });
		expect(first.status).toBe(200);

		const disabled = await call(disableUser, {
			locals: await actAs(tp!, alice.id),
			params: { id: bob.id }
		});
		expect(disabled.status).toBe(204);

		const resolve = reached();
		const res = await handle({ event: withKey('/api/v1/projects', raw), resolve });
		expect(res.status).toBe(401);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('after the owner is deleted', async () => {
		const { alice, bob, acme } = await seeded();
		const { raw } = await mintApiKey(tp!, bob.id, acme.id);
		const first = await handle({ event: withKey('/api/v1/projects', raw), resolve: reached() });
		expect(first.status).toBe(200);

		const deleted = await call(deleteUser, {
			locals: await actAs(tp!, alice.id),
			params: { id: bob.id },
			method: 'DELETE'
		});
		expect(deleted.status).toBe(204);

		const resolve = reached();
		const res = await handle({ event: withKey('/api/v1/projects', raw), resolve });
		expect(res.status).toBe(401);
		expect(resolve).not.toHaveBeenCalled();
	});
});
