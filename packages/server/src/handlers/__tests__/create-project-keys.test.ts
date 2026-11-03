/**
 * Creating projects with an API key: the `create_projects` scope, the one
 * visibility gate create and PATCH share, the holder rule it widens, and the
 * capability `/me` reports.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import {
	actAs,
	callHandler,
	grantPlatformPermissions,
	seedAcme,
	seedAcmeDesigner,
	seedOrg,
	seedOrgMember,
	seedUser,
	type ActingLocals,
	type AcmeFixture
} from '../../testing/index.js';
import { createApiTokenCodec } from '../../tokens/index.js';
import { createApiRateLimiter } from '../../api/index.js';
import { resolveApiToken } from '../../http/index.js';
import { createApiToken } from '../apiTokens.js';
import { createProject, updateProject } from '../projects.js';
import { projectScopeTarget } from '../../api/index.js';
import { getMe } from '../me.js';

const codec = createApiTokenCodec('k'.repeat(32));

let h: HandlerHarness | null = null;

afterEach(async () => {
	vi.restoreAllMocks();
	await h?.cleanup();
	h = null;
});

interface World extends AcmeFixture {
	h: HandlerHarness;
	dana: { id: string };
}

async function world(): Promise<World> {
	h = await freshHarness();
	h.deps = { ...h.deps, tokens: { ...h.deps?.tokens, apiTokens: codec } };
	const acme = await seedAcme(h);
	return { ...acme, h, dana: await seedAcmeDesigner(h, acme) };
}

function mint(locals: ActingLocals, orgId: string, scopes: string[]) {
	return callHandler(createApiToken, {
		locals,
		params: { orgId },
		body: { name: 'plugin', scopes, expiresInDays: 30 }
	});
}

async function asKey(w: World, userId: string, orgId: string, scopes: string[]) {
	const res = await mint(await actAs(w.h, userId), orgId, scopes);
	expect(res.status).toBe(201);
	const raw = (res.json as { secret: string }).secret;
	vi.spyOn(w.h.config.data.apiTokens!, 'touchLastUsed').mockResolvedValue();
	const result = await resolveApiToken(
		new Request('http://selva.test/api/v1/projects', {
			headers: { authorization: `Bearer ${raw}` }
		}),
		{ codec, auth: w.h.config.auth, data: w.h.config.data }
	);
	if (result.kind !== 'ok') throw new Error(`key rejected: ${JSON.stringify(result)}`);
	return { ...(await actAs(w.h, userId)), ctx: result.ctx };
}

// The options the POST /projects route mounts with.
const create = (locals: ActingLocals, body: object) =>
	callHandler(createProject, { locals, body, mount: { action: 'create_projects' } });

const PLUGIN_SCOPES = ['read:all', 'upload:all', 'create_projects:all'];

describe('a create_projects key', () => {
	it('creates a private project', async () => {
		const w = await world();
		const locals = await asKey(w, w.alice.id, w.acme.id, PLUGIN_SCOPES);
		const res = await create(locals, { name: 'From Grasshopper' });
		expect(res.status).toBe(201);
		expect(res.json).toMatchObject({ visibility: 'private', autoJoinOnUpload: false });
		expect((await create(locals, { name: 'Explicit', autoJoinOnUpload: false })).status).toBe(201);
	});

	it('is refused any other visibility, and autoJoinOnUpload', async () => {
		const w = await world();
		const locals = await asKey(w, w.alice.id, w.acme.id, PLUGIN_SCOPES);
		for (const body of [
			{ name: 'Org', visibility: 'org' },
			{ name: 'Public', visibility: 'public' },
			{ name: 'Joinable', visibility: 'org', autoJoinOnUpload: true }
		]) {
			expect((await create(locals, body)).status).toBe(403);
		}
	});

	it('is refused when scoped to one project', async () => {
		const w = await world();
		const locals = await asKey(w, w.alice.id, w.acme.id, [
			'upload:all',
			`create_projects:project:${w.acmeOrg.id}`
		]);
		expect((await create(locals, { name: 'Scoped' })).status).toBe(403);
	});

	it('still needs the owner to be allowed to create projects', async () => {
		const w = await world();
		const locals = await asKey(w, w.dana.id, w.acme.id, PLUGIN_SCOPES);
		expect((await create(locals, { name: 'Not allowed' })).status).toBe(403);
	});
});

describe('the per-owner quota', () => {
	it('stops a key owner creating projects past it, across their keys, but not their browser', async () => {
		const w = await world();
		w.h.deps = {
			...w.h.deps,
			projectCreateLimiter: createApiRateLimiter({ windowMs: 60_000, maxPerWindow: 1 })
		};
		const first = await asKey(w, w.alice.id, w.acme.id, PLUGIN_SCOPES);
		const second = await asKey(w, w.alice.id, w.acme.id, PLUGIN_SCOPES);
		expect((await create(first, { name: 'One' })).status).toBe(201);
		const refused = await create(second, { name: 'Two' });
		expect(refused.status).toBe(429);
		expect(refused.json).toMatchObject({ code: 'RATE_LIMITED' });
		const browser = await callHandler(createProject, {
			locals: await actAs(w.h, w.alice.id),
			body: { name: 'Three' }
		});
		expect(browser.status).toBe(201);
	});
});

describe('other keys on POST /projects', () => {
	it('refuses an upload-only key', async () => {
		const w = await world();
		const locals = await asKey(w, w.alice.id, w.acme.id, ['upload:all']);
		expect((await create(locals, { name: 'Nope' })).status).toBe(403);
	});

	it('lets a write key create any visibility its owner may set', async () => {
		const w = await world();
		await grantPlatformPermissions(w.h, w.alice.id, ['manage_api_tokens']);
		const locals = await asKey(w, w.alice.id, w.acme.id, ['write:all']);
		const res = await create(locals, { name: 'Open', visibility: 'public' });
		expect(res.status).toBe(201);
	});
});

describe('PATCH with a project-scoped write key', () => {
	it('still edits a project that isn’t private', async () => {
		const w = await world();
		await grantPlatformPermissions(w.h, w.alice.id, ['manage_api_tokens']);
		const locals = await asKey(w, w.alice.id, w.acme.id, [`write:project:${w.acmeOrg.id}`]);
		const res = await callHandler(updateProject, {
			locals,
			method: 'PATCH',
			params: { id: w.acmeOrg.id },
			body: { name: 'Renamed' },
			mount: { scopeTarget: projectScopeTarget() }
		});
		expect(res.status).toBe(204);
	});
});

describe('the public-visibility gate', () => {
	async function bobManagesProjects(w: World) {
		await w.h.config.data.orgs.updateOrgMemberPermissions(SYSTEM_CONTEXT, w.acme.id, w.bob.id, [
			'manage_projects'
		]);
		return actAs(w.h, w.bob.id);
	}

	it('refuses a member creating a public project, as PATCH does', async () => {
		const w = await world();
		const locals = await bobManagesProjects(w);
		const pub = await callHandler(createProject, {
			locals,
			body: { name: 'Leaky', visibility: 'public', autoJoinOnUpload: true }
		});
		expect(pub.status).toBe(403);

		const priv = await callHandler(createProject, { locals, body: { name: 'Quiet' } });
		expect(priv.status).toBe(201);
		const patched = await callHandler(updateProject, {
			locals,
			method: 'PATCH',
			params: { id: (priv.json as { id: string }).id },
			body: { visibility: 'public' }
		});
		expect(patched.status).toBe(403);
	});

	it('lets an org admin create a public project', async () => {
		const w = await world();
		const res = await callHandler(createProject, {
			locals: await actAs(w.h, w.alice.id),
			body: { name: 'Open', visibility: 'public' }
		});
		expect(res.status).toBe(201);
	});
});

describe('capabilities.createProjects on /me', () => {
	const createProjects = async (locals: ActingLocals) => {
		const res = await callHandler(getMe, { locals });
		expect(res.status).toBe(200);
		return (res.json as { capabilities: { createProjects: boolean } }).capabilities.createProjects;
	};

	it('follows the create rule for a session', async () => {
		const w = await world();
		expect(await createProjects(await actAs(w.h, w.alice.id))).toBe(true);
		expect(await createProjects(await actAs(w.h, w.dana.id))).toBe(false);
	});

	it('needs the scope on a key', async () => {
		const w = await world();
		expect(await createProjects(await asKey(w, w.alice.id, w.acme.id, ['upload:all']))).toBe(false);
		expect(await createProjects(await asKey(w, w.alice.id, w.acme.id, PLUGIN_SCOPES))).toBe(true);
	});
});

describe('holding a create_projects key', () => {
	it('an org admin with no projects may, an upload-only key still may not', async () => {
		const w = await world();
		const erin = await seedUser(w.h, 'erin@fresh.test');
		const fresh = await seedOrg(w.h, { name: 'Fresh', slug: 'fresh', ownerId: erin.id });
		await seedOrgMember(w.h, { orgId: fresh.id, userId: erin.id, role: 'admin' });
		const locals = await actAs(w.h, erin.id);
		expect(locals.ctx.actingOrgId).toBe(fresh.id);

		expect((await mint(locals, fresh.id, ['upload:all'])).status).toBe(403);
		expect((await mint(locals, fresh.id, PLUGIN_SCOPES)).status).toBe(201);
	});

	it('a member who may neither create a definition nor a project may not', async () => {
		const w = await world();
		const res = await mint(await actAs(w.h, w.bob.id), w.acme.id, PLUGIN_SCOPES);
		expect(res.status).toBe(403);
	});
});
