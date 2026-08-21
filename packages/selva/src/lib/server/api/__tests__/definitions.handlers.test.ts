/**
 * The definition handlers, exercised through the SvelteKit binding.
 *
 * The behaviour worth guarding here is the existence oracle: every read of an
 * invisible definition must answer 404, never 403. `getVisibleDefinition`
 * returns `null` rather than throwing precisely so the handler cannot leak the
 * distinction — and a handler that "helpfully" turns that null into a 403 puts
 * the leak back with no type error and no other test failing.
 *
 * `services.definitions` is the other new surface: it is host-supplied, so a
 * host that mounts these without wiring it must fail loudly rather than
 * dereference undefined.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '../sveltekit.js';
import {
	deleteDefinition,
	getDefinition,
	getDefinitionSchema,
	listDefinitions,
	publishDefinition,
	updateDefinition
} from '../handlers/definitions.js';
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

describe('GET /api/v1/definitions/[guid]', () => {
	it('returns the record with live and draft version summaries', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, { projectId: alicesPrivate.id, userId: alice.id, role: 'owner' });
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const res = await call(mount('Failed to load definition', getDefinition), {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid }
		});

		expect(res.status).toBe(200);
		expect(res.json).toMatchObject({ guid: def.record.guid });
	});

	it('returns 404, not 403, for a definition in another org’s private project', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { carol } = await seedBigClient(tp);

		const res = await call(mount('Failed to load definition', getDefinition), {
			locals: await actAs(tp, carol.id),
			params: { guid: def.record.guid }
		});

		// 403 would confirm the guid exists across a tenant boundary.
		expect(res.status).toBe(404);
	});

	it('rejects a malformed guid with 400 before any store read', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);

		const res = await call(mount('Failed to load definition', getDefinition), {
			locals: await actAs(tp, alice.id),
			params: { guid: 'not-a-guid' }
		});

		expect(res.status).toBe(400);
	});
});

describe('GET /api/v1/definitions/[guid]/schema', () => {
	it('resolves the live pointer and returns the cached schema', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, { projectId: alicesPrivate.id, userId: alice.id, role: 'owner' });
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const res = await call(mount('Failed to load definition schema', getDefinitionSchema), {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid }
		});

		// `create` publishes v1, so the live pointer is set from the start.
		expect(res.status).toBe(200);
		expect(res.json).toMatchObject({ name: 'Test' });
	});

	it('404s for an invisible definition rather than revealing it exists', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { carol } = await seedBigClient(tp);

		const res = await call(mount('Failed to load definition schema', getDefinitionSchema), {
			locals: await actAs(tp, carol.id),
			params: { guid: def.record.guid }
		});

		expect(res.status).toBe(404);
	});
});

describe('definition write guards', () => {
	it('rejects a non-editor PATCH with 403, not 500', async () => {
		tp = await freshProviders();
		const { alice, bob, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		await seedProjectMember(tp, { projectId: alicesPrivate.id, userId: bob.id, role: 'viewer' });

		const res = await call(mount('Failed to update definition', updateDefinition), {
			locals: await actAs(tp, bob.id),
			params: { guid: def.record.guid },
			body: { displayName: 'Hijacked' }
		});

		expect(res.status).toBe(403);
	});

	it('rejects a non-editor DELETE with 403', async () => {
		tp = await freshProviders();
		const { alice, bob, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		await seedProjectMember(tp, { projectId: alicesPrivate.id, userId: bob.id, role: 'viewer' });

		const res = await call(mount('Failed to delete definition', deleteDefinition), {
			locals: await actAs(tp, bob.id),
			params: { guid: def.record.guid }
		});

		expect(res.status).toBe(403);
	});

	it('lets an owner update metadata', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, { projectId: alicesPrivate.id, userId: alice.id, role: 'owner' });
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const locals = await actAs(tp, alice.id);
		const res = await call(mount('Failed to update definition', updateDefinition), {
			locals,
			params: { guid: def.record.guid },
			body: { displayName: 'Renamed' }
		});

		expect(res.status).toBe(204);
		const after = await tp.config.data.definitions.get(locals.ctx, def.record.guid);
		// A handler that guards correctly and then forgets to write still 204s.
		expect(after?.displayName).toBe('Renamed');
	});

	it('publishes the draft for an owner', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, { projectId: alicesPrivate.id, userId: alice.id, role: 'owner' });
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const locals = await actAs(tp, alice.id);
		const res = await call(mount('Failed to publish version', publishDefinition), {
			locals,
			params: { guid: def.record.guid },
			body: {}
		});

		expect(res.status).toBe(200);
		const after = await tp.config.data.definitions.get(locals.ctx, def.record.guid);
		expect(after?.liveVersionId).toBeTruthy();
	});
});

describe('dependency injection', () => {
	it('reads the definition list through the injected deps', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, { projectId: alicesPrivate.id, userId: alice.id, role: 'owner' });
		await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const locals = await actAs(tp, alice.id);
		let sawList = false;
		locals.providers = spyOnStore(locals.providers, 'definitions', 'list', () => {
			sawList = true;
		});

		const res = await call(mount('Failed to list definitions', listDefinitions), {
			locals,
			url: 'http://test.local/api/v1/definitions'
		});

		expect(res.status).toBe(200);
		// `listVisibleDefinitions` took no deps before this tranche — it read the
		// module global regardless of what the request carried.
		expect(sawList).toBe(true);
	});

	it('fails loudly when a host mounts the handlers without wiring services.definitions', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, { projectId: alicesPrivate.id, userId: alice.id, role: 'owner' });
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const locals = await actAs(tp, alice.id);
		const stripped = {
			...(await import('../sveltekit.js')).toApiRequest({
				locals,
				params: { guid: def.record.guid },
				url: new URL('http://test.local/'),
				request: new Request('http://test.local/', { method: 'DELETE' })
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any)
		};
		stripped.deps = { ...stripped.deps, services: {} };

		// The 500 is the point: a missing service must not surface as
		// "Cannot read properties of undefined".
		await expect(deleteDefinition(stripped)).rejects.toThrow(/services\.definitions/);
	});
});
