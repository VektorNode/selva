import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import {
	actAs,
	callHandler,
	seedAcme,
	seedAcmeDesigner,
	seedDefinition,
	seedProjectMember,
	seedUser
} from '../../testing/index.js';
import { uploadDefinitionImage } from '../definitions.js';

// 1x1 transparent PNG.
const PNG = Uint8Array.from(
	atob(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
	),
	(c) => c.charCodeAt(0)
);

let h: HandlerHarness | null = null;

afterEach(async () => {
	await h?.cleanup();
	h = null;
});

async function world() {
	h = await freshHarness();
	const acme = await seedAcme(h);
	const dana = await seedAcmeDesigner(h, acme);
	const { record } = await seedDefinition(h, {
		projectId: acme.acmeOrg.id,
		ownerId: acme.alice.id
	});
	return { ...acme, dana, guid: record.guid };
}

async function uploadCover(userId: string, guid: string) {
	const form = new FormData();
	form.set('image', new File([PNG], 'cover.png', { type: 'image/png' }));
	return callHandler(uploadDefinitionImage, {
		locals: await actAs(h!, userId),
		params: { guid },
		body: form
	});
}

async function coverOf(guid: string): Promise<string | undefined> {
	return (await h!.config.data.definitions.get(SYSTEM_CONTEXT, guid))?.coverImage ?? undefined;
}

describe('POST /definitions/{guid}/image', () => {
	it('lets a project editor set the cover', async () => {
		const w = await world();
		const res = await uploadCover(w.dana.id, w.guid);
		expect(res.status).toBe(200);
		expect(await coverOf(w.guid)).toBe((res.json as { coverImage: string }).coverImage);
	});

	it('refuses an org member who can see the project but holds no role in it', async () => {
		const w = await world();
		const res = await uploadCover(w.bob.id, w.guid);
		expect(res.status).toBe(403);
		expect(res.json).toMatchObject({
			message: 'You do not have permission to edit this definition.'
		});
		expect(await coverOf(w.guid)).toBeUndefined();
	});

	it('refuses a project viewer', async () => {
		const w = await world();
		await seedProjectMember(h!, { projectId: w.acmeOrg.id, userId: w.bob.id, role: 'viewer' });
		const res = await uploadCover(w.bob.id, w.guid);
		expect(res.status).toBe(403);
		expect(await coverOf(w.guid)).toBeUndefined();
	});

	// instance_admin bypasses management checks, never content ones.
	it('refuses an instance admin who is not on the project', async () => {
		const w = await world();
		const staff = await seedUser(h!, 'staff@selva.test', ['instance_admin']);
		const res = await uploadCover(staff.id, w.guid);
		expect(res.status).toBe(403);
		expect(await coverOf(w.guid)).toBeUndefined();
	});
});
