import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT, narrowApiTokenContext } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import {
	actAs,
	callHandler,
	seedAcme,
	seedBigClient,
	type ActingLocals
} from '../../testing/index.js';
import { removeOrgAsset, uploadOrgAsset } from '../orgAssets.js';

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

function logoForm(): FormData {
	const form = new FormData();
	form.set('image', new File([PNG], 'logo.png', { type: 'image/png' }));
	return form;
}

const upload = (locals: unknown, orgId: string) =>
	callHandler(uploadOrgAsset, {
		locals,
		params: { orgId, kind: 'logo' },
		body: logoForm()
	});

const remove = (locals: unknown, orgId: string) =>
	callHandler(removeOrgAsset, {
		locals,
		params: { orgId, kind: 'logo' },
		method: 'DELETE'
	});

async function logoOf(orgId: string): Promise<string | undefined> {
	const org = await h!.config.data.orgs.getOrg(SYSTEM_CONTEXT, orgId);
	return org?.assets?.logo;
}

function withKey(locals: ActingLocals, scopes: string[]): ActingLocals {
	return {
		...locals,
		ctx: narrowApiTokenContext(locals.ctx, {
			id: 'key-1',
			orgId: locals.ctx.actingOrgId!,
			scopes,
			expiresAt: '2099-01-01T00:00:00.000Z'
		})
	};
}

async function world() {
	h = await freshHarness();
	const acme = await seedAcme(h);
	const big = await seedBigClient(h);
	return { ...acme, ...big };
}

describe('POST /orgs/{orgId}/assets/{kind}', () => {
	it('lets an org admin set the logo', async () => {
		const w = await world();
		const res = await upload(await actAs(h!, w.alice.id), w.acme.id);
		expect(res.status).toBe(200);
		expect(await logoOf(w.acme.id)).toBe((res.json as { url: string }).url);
	});

	it('refuses a member without manage_org_members', async () => {
		const w = await world();
		const res = await upload(await actAs(h!, w.bob.id), w.acme.id);
		expect(res.status).toBe(403);
		expect(res.json).toMatchObject({ code: 'FORBIDDEN' });
		expect(await logoOf(w.acme.id)).toBeUndefined();
	});

	it('refuses an admin naming another org', async () => {
		const w = await world();
		const res = await upload(await actAs(h!, w.alice.id), w.bigClient.id);
		expect(res.status).toBe(403);
		expect(res.json).toMatchObject({ message: 'Acting org does not match the target org.' });
		expect(await logoOf(w.bigClient.id)).toBeUndefined();
	});

	// Branding grants no access, so a key may change it.
	it('lets a write key whose owner holds manage_org_members set the logo', async () => {
		const w = await world();
		const res = await upload(withKey(await actAs(h!, w.alice.id), ['write:all']), w.acme.id);
		expect(res.status).toBe(200);
		expect(await logoOf(w.acme.id)).toBeDefined();
	});

	it('refuses a write key whose owner lacks manage_org_members, and a read key', async () => {
		const w = await world();
		const member = await upload(withKey(await actAs(h!, w.bob.id), ['write:all']), w.acme.id);
		expect(member.status).toBe(403);
		const readOnly = await upload(withKey(await actAs(h!, w.alice.id), ['read:all']), w.acme.id);
		expect(readOnly.status).toBe(403);
		expect(await logoOf(w.acme.id)).toBeUndefined();
	});
});

describe('DELETE /orgs/{orgId}/assets/{kind}', () => {
	async function withLogos() {
		const w = await world();
		expect((await upload(await actAs(h!, w.alice.id), w.acme.id)).status).toBe(200);
		await h!.config.data.orgs.updateOrg(SYSTEM_CONTEXT, w.bigClient.id, {
			assets: { logo: 'https://cdn.test/big.webp' }
		});
		return w;
	}

	it('lets an org admin remove the logo', async () => {
		const w = await withLogos();
		const res = await remove(await actAs(h!, w.alice.id), w.acme.id);
		expect(res.status).toBe(204);
		expect(await logoOf(w.acme.id)).toBeUndefined();
	});

	it('refuses a member without manage_org_members', async () => {
		const w = await withLogos();
		const res = await remove(await actAs(h!, w.bob.id), w.acme.id);
		expect(res.status).toBe(403);
		expect(await logoOf(w.acme.id)).toBeDefined();
	});

	it('refuses an admin naming another org', async () => {
		const w = await withLogos();
		const res = await remove(await actAs(h!, w.alice.id), w.bigClient.id);
		expect(res.status).toBe(403);
		expect(await logoOf(w.bigClient.id)).toBe('https://cdn.test/big.webp');
	});

	it('lets a write key whose owner holds manage_org_members remove it', async () => {
		const w = await withLogos();
		const res = await remove(withKey(await actAs(h!, w.alice.id), ['write:all']), w.acme.id);
		expect(res.status).toBe(204);
		expect(await logoOf(w.acme.id)).toBeUndefined();
	});
});
