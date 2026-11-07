import { describe, it, expect, afterEach } from 'vitest';
import {
	freshProviders,
	seedAcme,
	seedDefinition,
	seedShareLink,
	grantPlatformPermissions,
	sessionTokenFor,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { getBootHealth } from '#lib/server/bootHealth.server.js';
import { handle } from '../hooks.server';
import { ORIGIN, hookEvent, reached } from './hook-requests';

/**
 * A share link works without an account, so the hook must let a request that
 * carries one reach the two routes that resolve it. These drive `handle` itself:
 * the routes' own token checks are covered beside them.
 */

let tp: TestProviders | null = null;

afterEach(async () => {
	// The first request kicks the boot health check; let it finish before its providers go.
	await getBootHealth();
	await tp?.cleanup();
	tp = null;
});

async function seeded(flags: Record<string, boolean>) {
	tp = await freshProviders({ flags });
	const { alice, alicesPrivate } = await seedAcme(tp);
	// An admin exists, so the first-run redirect stays out of the way.
	await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
	const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
	const { rawToken } = await seedShareLink(tp, {
		definitionId: def.record.guid,
		createdBy: alice.id,
		channel: 'live'
	});
	return { guid: def.record.guid, rawToken, alice };
}

function anonymousEvent(
	pathAndQuery: string,
	init: { method?: string; headers?: Record<string, string> } = {}
) {
	return hookEvent(pathAndQuery, {
		method: init.method,
		headers: { origin: ORIGIN, ...init.headers },
		body: init.method === 'POST' ? '{}' : undefined
	});
}

describe('share-link requests through the hook', () => {
	it('lets an anonymous solve with a share token in the Authorization header reach the route', async () => {
		const { rawToken } = await seeded({ ENABLE_SHARING: true });
		const resolve = reached();
		const event = anonymousEvent('/api/v1/compute', {
			method: 'POST',
			headers: { authorization: `Bearer ${rawToken}`, 'content-type': 'application/json' }
		});

		const res = await handle({ event, resolve });

		expect(resolve).toHaveBeenCalledOnce();
		expect(res.status).toBe(200);
		expect(event.locals.user).toBeUndefined();
	});

	it('lets an anonymous visitor open the library page with a share token in the URL', async () => {
		const { guid, rawToken } = await seeded({ ENABLE_SHARING: true });
		const resolve = reached();

		const res = await handle({
			event: anonymousEvent(`/library/${guid}?token=${rawToken}`),
			resolve
		});

		expect(resolve).toHaveBeenCalledOnce();
		expect(res.status).toBe(200);
	});

	it('still refuses an anonymous solve that carries no token', async () => {
		await seeded({ ENABLE_SHARING: true });
		const resolve = reached();

		const res = await handle({
			event: anonymousEvent('/api/v1/compute', { method: 'POST' }),
			resolve
		});

		expect(res.status).toBe(401);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('does not open any other route to a share token', async () => {
		const { rawToken } = await seeded({ ENABLE_SHARING: true });
		const resolve = reached();

		const res = await handle({
			event: anonymousEvent('/api/v1/definitions', {
				headers: { authorization: `Bearer ${rawToken}` }
			}),
			resolve
		});

		expect(res.status).toBe(401);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('attaches the session of a signed-in visitor who carries a share token', async () => {
		const { guid, rawToken, alice } = await seeded({ ENABLE_SHARING: true });
		const resolve = reached();
		const event = hookEvent(`/library/${guid}?token=${rawToken}`, {
			headers: { origin: ORIGIN },
			cookies: { admin_session: sessionTokenFor(alice.id) }
		});

		await handle({ event, resolve });

		expect(resolve).toHaveBeenCalledOnce();
		expect(event.locals.user?.id).toBe(alice.id);
	});

	it.each([['channel=draft'], ['version=v1']])(
		'sends an anonymous visitor on a %s pick to sign in: the page serves only the live pointer by token',
		async (pick) => {
			const { guid, rawToken } = await seeded({ ENABLE_SHARING: true });
			const resolve = reached();

			await expect(
				handle({ event: anonymousEvent(`/library/${guid}?token=${rawToken}&${pick}`), resolve })
			).rejects.toMatchObject({
				status: 303,
				location: `/login?redirectTo=${encodeURIComponent(`/library/${guid}?${pick}`)}`
			});
			expect(resolve).not.toHaveBeenCalled();
		}
	);

	it('drops every share-shaped token param from redirectTo, not just the first', async () => {
		const { guid, rawToken } = await seeded({ ENABLE_SHARING: true });
		const resolve = reached();

		await expect(
			handle({
				event: anonymousEvent(`/library/${guid}/edit?token=foo&token=${rawToken}`),
				resolve
			})
		).rejects.toMatchObject({
			status: 303,
			location: `/login?redirectTo=${encodeURIComponent(`/library/${guid}/edit?token=foo`)}`
		});
	});

	it('with sharing off, sends the visitor to sign in without the token in redirectTo', async () => {
		const { guid, rawToken } = await seeded({ ENABLE_SHARING: false });
		const resolve = reached();

		await expect(
			handle({ event: anonymousEvent(`/library/${guid}?token=${rawToken}&view=3d`), resolve })
		).rejects.toMatchObject({
			status: 303,
			location: `/login?redirectTo=${encodeURIComponent(`/library/${guid}?view=3d`)}`
		});
		expect(resolve).not.toHaveBeenCalled();
	});
});
