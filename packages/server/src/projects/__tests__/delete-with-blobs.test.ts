import { afterEach, describe, expect, it } from 'vitest';
import { SYSTEM_CONTEXT, definitionPaths, orgPaths } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { deleteOrgWithBlobs, deleteProjectWithBlobs } from '../delete-with-blobs.js';
import { seedAcme, seedDefinition } from '../../testing/index.js';

let tp: HandlerHarness | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

const stores = (h: HandlerHarness) => ({
	orgs: h.config.data.orgs,
	projects: h.config.data.projects,
	definitions: h.config.data.definitions,
	storage: h.config.storage
});

async function seedBlob(h: HandlerHarness, projectId: string, ownerId: string): Promise<string> {
	const { record } = await seedDefinition(h, { projectId, ownerId, displayName: 'D' });
	const path = definitionPaths.version(record.guid, 1, 'gh');
	await h.config.storage.put(path, new Uint8Array([1]));
	return path;
}

describe('deleteProjectWithBlobs', () => {
	it('wipes the blobs of every definition in the project and no other', async () => {
		tp = await freshHarness();
		const { alice, alicesPrivate, acmeOrg } = await seedAcme(tp);
		const doomed = await seedBlob(tp, alicesPrivate.id, alice.id);
		const kept = await seedBlob(tp, acmeOrg.id, alice.id);

		await deleteProjectWithBlobs(stores(tp), SYSTEM_CONTEXT, alicesPrivate.id);

		expect(await tp.config.storage.get(doomed)).toBeNull();
		expect(await tp.config.storage.get(kept)).not.toBeNull();
	});

	it('leaves blobs alone when the delete is refused', async () => {
		tp = await freshHarness();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const path = await seedBlob(tp, alicesPrivate.id, alice.id);
		const failing = {
			...stores(tp),
			projects: {
				...tp.config.data.projects,
				deleteProject: async () => {
					throw new Error('refused');
				}
			}
		};

		await expect(deleteProjectWithBlobs(failing, SYSTEM_CONTEXT, alicesPrivate.id)).rejects.toThrow(
			'refused'
		);

		expect(await tp.config.storage.get(path)).not.toBeNull();
	});
});

describe('deleteOrgWithBlobs', () => {
	it('wipes branding and every project blob', async () => {
		tp = await freshHarness();
		const { acme, alice, alicesPrivate } = await seedAcme(tp);
		const definition = await seedBlob(tp, alicesPrivate.id, alice.id);
		const logo = orgPaths.asset(acme.id, 'logo');
		await tp.config.storage.put(logo, new Uint8Array([1]), 'text/plain');

		await deleteOrgWithBlobs(stores(tp), SYSTEM_CONTEXT, acme.id);

		expect(await tp.config.storage.get(logo)).toBeNull();
		expect(await tp.config.storage.get(definition)).toBeNull();
	});
});
