import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	freshProviders,
	seedAcme,
	grantPlatformPermissions,
	sessionTokenFor,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { getBootHealth } from '#lib/server/bootHealth.server.js';
import { handle } from '../hooks.server';
import { ORIGIN, hookEvent, mintApiKey, reached } from './hook-requests';

// The hook skips its CSRF check under the dev server, which is what vitest runs as.
vi.mock('$app/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/env')>()),
	dev: false
}));

const ELSEWHERE = 'https://elsewhere.test';
const FORM = 'application/x-www-form-urlencoded';

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

function formPost(path: string, headers: Record<string, string>, cookies = {}) {
	return hookEvent(path, {
		method: 'POST',
		headers: { 'content-type': FORM, ...headers },
		body: 'name=x',
		cookies
	});
}

describe('cross-site form submissions through the hook', () => {
	it('refuses one from another origin that carries a session cookie', async () => {
		const { alice } = await seeded();
		const resolve = reached();

		const res = await handle({
			event: formPost(
				'/api/v1/projects',
				{ origin: ELSEWHERE },
				{ admin_session: sessionTokenFor(alice.id) }
			),
			resolve
		});

		expect(res.status).toBe(403);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('lets the same form through from the app’s own origin', async () => {
		const { alice } = await seeded();
		const resolve = reached();

		const res = await handle({
			event: formPost(
				'/api/v1/projects',
				{ origin: ORIGIN },
				{ admin_session: sessionTokenFor(alice.id) }
			),
			resolve
		});

		expect(res.status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('exempts the OAuth token endpoint, which servers call with no Origin', async () => {
		await seeded();
		const resolve = reached();

		const res = await handle({ event: formPost('/oauth/token', {}), resolve });

		expect(res.status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('exempts a request that authenticates with a Selva API key', async () => {
		const { alice, acme } = await seeded();
		const { raw } = await mintApiKey(tp!, alice.id, acme.id);
		const resolve = reached();

		const res = await handle({
			event: formPost('/api/v1/definitions', { authorization: `Bearer ${raw}` }),
			resolve
		});

		expect(res.status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('still checks a request whose bearer is not a Selva API key', async () => {
		const { alice } = await seeded();
		const resolve = reached();

		const res = await handle({
			event: formPost(
				'/api/v1/projects',
				{ origin: ELSEWHERE, authorization: 'Bearer proxy-id-token' },
				{ admin_session: sessionTokenFor(alice.id) }
			),
			resolve
		});

		expect(res.status).toBe(403);
		expect(resolve).not.toHaveBeenCalled();
	});
});
