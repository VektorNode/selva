/**
 * The share-link ctx carries `system: true` so the Supabase adapter picks the
 * service-role client — no user JWT exists on a token-credentialed request.
 * Every store guard begins `if (ctx.system) return`, so without a second marker
 * an anonymous token holder satisfies `assertAdmin`.
 *
 * `shareLinkId` is that marker. These tests pin the split: `system` still means
 * "service-role dispatch", never "authorized".
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT, isShareContext } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedDefinition,
	seedShareLink,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { tryResolveShareToken } from '$lib/server/shareLinks/resolve.server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

async function resolveShareCtx(tp: TestProviders) {
	const { alice, alicesPrivate } = await seedAcme(tp);
	const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
	const { rawToken, link } = await seedShareLink(tp, {
		definitionId: def.record.guid,
		createdBy: alice.id,
		channel: 'live'
	});
	const url = new URL(`http://test.local/?token=${encodeURIComponent(rawToken)}`);
	const resolved = await tryResolveShareToken(
		new Request(url.toString()),
		url,
		def.record.guid,
		'live',
		{
			requireSolve: true
		}
	);
	if (!resolved) throw new Error('expected the token to resolve');
	return { resolved, alice, link };
}

describe('share-link ctx is not an authority', () => {
	it('is marked as a share context despite system: true', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { resolved } = await resolveShareCtx(tp);

		expect(resolved.ctx.system).toBe(true);
		expect(isShareContext(resolved.ctx)).toBe(true);
		expect(isShareContext(SYSTEM_CONTEXT)).toBe(false);
	});

	it('cannot grant itself platform permissions', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { resolved, alice } = await resolveShareCtx(tp);

		await expect(
			tp.config.data.permissions.set(resolved.ctx, alice.id, ['instance_admin'])
		).rejects.toMatchObject({ statusCode: 403 });

		// And nothing was written.
		expect(await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, alice.id)).not.toContain(
			'instance_admin'
		);
	});

	it("cannot read another user's permissions", async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { resolved, alice } = await resolveShareCtx(tp);

		await expect(tp.config.data.permissions.getFor(resolved.ctx, alice.id)).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('a real system context still passes those guards', async () => {
		// The gate must narrow share contexts only — server-internal callers
		// (bootstrap, janitors) still need the bypass.
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice } = await seedAcme(tp);

		await expect(
			tp.config.data.permissions.set(SYSTEM_CONTEXT, alice.id, ['manage_compute'])
		).resolves.toBe('ok');
	});
});
