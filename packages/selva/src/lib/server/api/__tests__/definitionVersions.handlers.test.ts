/**
 * Version handlers through the binding.
 *
 * Two invariants worth guarding:
 *
 * - **A version read never carries `schema`.** GET strips it because the blob
 *   runs to hundreds of KB; the `/schema` sub-resource serves it on demand. A
 *   handler that returns the version whole is correct-looking and quietly
 *   multiplies every list response.
 * - **Version ids are scoped to their definition.** `loadVisibleVersion` checks
 *   `version.definitionId === record.guid`, so pairing a readable guid with a
 *   foreign versionId must 404 rather than serve another tenant's version.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '../sveltekit.js';
import { depsFromConfig } from '@selvajs/server/api';
import {
	deleteVersion,
	getVersion,
	getVersionSchema,
	listVersions,
	uploadVersion
} from '../handlers/definitionVersions.js';
import {
	freshProviders,
	seedAcme,
	seedBigClient,
	seedDefinition,
	seedProjectMember,
	actAs,
	call,
	spyOnStore,
	type TestProviders
} from '../../__tests__/fixtures.js';

let tp: TestProviders;

afterEach(async () => {
	await tp?.cleanup();
});

async function ownedDefinition() {
	const { alice, bob, alicesPrivate } = await seedAcme(tp);
	await seedProjectMember(tp, { projectId: alicesPrivate.id, userId: alice.id, role: 'owner' });
	const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
	return { alice, bob, alicesPrivate, def };
}

describe('GET versions', () => {
	it('lists versions for a viewer', async () => {
		tp = await freshProviders();
		const { alice, def } = await ownedDefinition();

		const res = await call(mount('Failed to list versions', listVersions), {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid }
		});

		expect(res.status).toBe(200);
		expect((res.json as { items: unknown[] }).items.length).toBeGreaterThan(0);
	});

	it('404s rather than 403 for a definition in another org', async () => {
		tp = await freshProviders();
		const { def } = await ownedDefinition();
		const { carol } = await seedBigClient(tp);

		const res = await call(mount('Failed to list versions', listVersions), {
			locals: await actAs(tp, carol.id),
			params: { guid: def.record.guid }
		});

		expect(res.status).toBe(404);
	});
});

describe('GET versions/[versionId]', () => {
	it('omits the schema blob from version metadata', async () => {
		tp = await freshProviders();
		const { alice, def } = await ownedDefinition();

		const res = await call(mount('Failed to load version', getVersion), {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid, versionId: def.version.id }
		});

		expect(res.status).toBe(200);
		expect(res.json).toMatchObject({ id: def.version.id });
		// The sub-resource serves it; a metadata read must not.
		expect(res.json).not.toHaveProperty('schema');
	});

	it('404s when the versionId belongs to a different definition', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate, def } = await ownedDefinition();
		const other = await seedDefinition(tp, {
			projectId: alicesPrivate.id,
			ownerId: alice.id
		});

		const res = await call(mount('Failed to load version', getVersion), {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid, versionId: other.version.id }
		});

		// Both are readable by Alice; the pairing is what must be rejected.
		expect(res.status).toBe(404);
	});
});

describe('GET versions/[versionId]/schema', () => {
	it('serves the cached schema', async () => {
		tp = await freshProviders();
		const { alice, def } = await ownedDefinition();

		const res = await call(mount('Failed to load version schema', getVersionSchema), {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid, versionId: def.version.id }
		});

		expect(res.status).toBe(200);
		expect(res.json).toMatchObject({ name: 'Test' });
	});

	it('404s for a foreign versionId', async () => {
		tp = await freshProviders();
		const { def } = await ownedDefinition();
		const { carol } = await seedBigClient(tp);

		const res = await call(mount('Failed to load version schema', getVersionSchema), {
			locals: await actAs(tp, carol.id),
			params: { guid: def.record.guid, versionId: def.version.id }
		});

		expect(res.status).toBe(404);
	});
});

describe('DELETE versions/[versionId]', () => {
	it('rejects a non-editor with 403', async () => {
		tp = await freshProviders();
		const { bob, alicesPrivate, def } = await ownedDefinition();
		await seedProjectMember(tp, { projectId: alicesPrivate.id, userId: bob.id, role: 'viewer' });

		const res = await call(mount('Failed to delete version', deleteVersion), {
			locals: await actAs(tp, bob.id),
			params: { guid: def.record.guid, versionId: def.version.id }
		});

		expect(res.status).toBe(403);
	});

	it('409s when the version is still the live pointer', async () => {
		tp = await freshProviders();
		const { alice, def } = await ownedDefinition();

		const res = await call(mount('Failed to delete version', deleteVersion), {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid, versionId: def.version.id }
		});

		// `create` publishes v1, so this version is referenced — repoint first.
		expect(res.status).toBe(409);
	});
});

describe('dependency injection', () => {
	it('lists versions through the injected deps', async () => {
		tp = await freshProviders();
		const { alice, def } = await ownedDefinition();

		const locals = await actAs(tp, alice.id);
		let sawList = false;
		locals.providers = spyOnStore(locals.providers, 'definitions', 'listVersions', () => {
			sawList = true;
		});

		const res = await call(mount('Failed to list versions', listVersions), {
			locals,
			params: { guid: def.record.guid }
		});

		expect(res.status).toBe(200);
		expect(sawList).toBe(true);
	});
});

/**
 * The upload cap is read from `deps.uploadLimits`, not a module constant.
 *
 * Worth its own test because nothing else exercises it: every other upload in
 * this suite is comfortably under the limit, so a handler that ignored the
 * injected cap would pass the whole file green.
 *
 * Calls the handler directly rather than through `mount`, because the point is
 * that the cap travels on `deps` — routing it through the binding would test
 * the binding's wiring instead, which is a different claim.
 */
describe('upload limits come from deps', () => {
	it('rejects a file over the injected cap', async () => {
		tp = await freshProviders();
		const { alice, def } = await ownedDefinition();
		const locals = await actAs(tp, alice.id);

		const form = new FormData();
		form.set('file', new File([new Uint8Array(4096)], 'big.gh'));

		const deps = depsFromConfig(
			locals.providers,
			{},
			{ uploadLimits: { maxDefinitionFileSize: 1024 } }
		);

		await expect(
			uploadVersion({
				ctx: locals.ctx,
				user: locals.user,
				profile: locals.profile,
				log: locals.log,
				params: { guid: def.record.guid },
				url: new URL('http://test.local/'),
				request: new Request('http://test.local/', { method: 'POST', body: form }),
				deps
			})
		).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/too large/i) });
	});
});
