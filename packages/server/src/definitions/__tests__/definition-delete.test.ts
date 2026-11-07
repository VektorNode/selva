/**
 * Deletes against the real local stack, asserting on the stored blobs: a
 * delete that leaves them behind keeps a user's upload after they asked for it
 * gone, and one that removes them before the store agrees breaks a live version.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SYSTEM_CONTEXT, type DefinitionVersion, type UISchema } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { seedAcme, seedDefinition } from '../../testing/index.js';

let tp: HandlerHarness | null = null;

afterEach(async () => {
	await tp?.cleanup();
	tp = null;
});

const SCHEMA = { name: 'Test', inputs: [], outputs: [] } as unknown as UISchema;

/** A definition whose v1 is neither live nor draft, v2 is live and v3 is draft. */
async function seedThreeVersions() {
	const h = await freshHarness();
	tp = h;
	const { alice, alicesPrivate } = await seedAcme(h);
	const { record, version: v1 } = await seedDefinition(h, {
		projectId: alicesPrivate.id,
		ownerId: alice.id
	});
	const svc = h.definitionService;
	const upload = (): Promise<DefinitionVersion> =>
		svc.uploadVersion(SYSTEM_CONTEXT, record.guid, new Uint8Array([2]), 'gh', 'test.gh', SCHEMA);
	const v2 = await upload();
	await svc.publish(SYSTEM_CONTEXT, record.guid, v2.id);
	const v3 = await upload();

	const blob = (v: DefinitionVersion) => h.config.storage.get(v.fileKey);
	for (const v of [v1, v2, v3]) expect(await blob(v)).not.toBeNull();
	return { svc, guid: record.guid, v1, v2, v3, blob };
}

describe('DefinitionService.delete', () => {
	it('hides the record and removes every version blob', async () => {
		const { svc, guid, v1, v2, v3, blob } = await seedThreeVersions();

		await svc.delete(SYSTEM_CONTEXT, guid);

		expect(await tp!.config.data.definitions.get(SYSTEM_CONTEXT, guid)).toBeNull();
		for (const v of [v1, v2, v3]) expect(await blob(v)).toBeNull();
	});
});

describe('DefinitionService.deleteVersion', () => {
	it('removes the blob of a version no channel points at', async () => {
		const { svc, guid, v1, v2, v3, blob } = await seedThreeVersions();

		await svc.deleteVersion(SYSTEM_CONTEXT, guid, v1.id);

		expect(await blob(v1)).toBeNull();
		expect(await blob(v2)).not.toBeNull();
		expect(await blob(v3)).not.toBeNull();
	});

	it.each([
		['live', 'v2'],
		['draft', 'v3']
	] as const)('refuses the %s version and keeps its blob', async (_channel, which) => {
		const seeded = await seedThreeVersions();
		const version = seeded[which];

		await expect(
			seeded.svc.deleteVersion(SYSTEM_CONTEXT, seeded.guid, version.id)
		).rejects.toThrow();

		expect(await seeded.blob(version)).not.toBeNull();
	});
});
