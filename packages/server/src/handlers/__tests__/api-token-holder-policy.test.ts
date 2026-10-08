/**
 * A host-supplied `mayHoldApiTokens` replaces `manage_api_tokens` at mint, and
 * the resolver re-asks it on every request, so losing the role turns the key
 * off without revoking it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { hasPermission, SYSTEM_CONTEXT } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { seedAcme, actAs, callHandler } from '../../testing/index.js';
import { createApiTokenCodec, type ApiTokenHolderPolicy } from '../../tokens/index.js';
import { resolveApiToken } from '../../http/index.js';
import { createApiToken, listApiTokens } from '../apiTokens.js';

const codec = createApiTokenCodec('k'.repeat(32));
const shopAdmins: ApiTokenHolderPolicy = (ctx) => hasPermission(ctx, 'manage_org_members');
const body = { name: 'CI', scopes: ['read:all'], expiresInDays: 30 };

let tp: HandlerHarness | null = null;

afterEach(async () => {
	await tp?.cleanup();
	tp = null;
});

async function harness(policy?: ApiTokenHolderPolicy): Promise<HandlerHarness> {
	tp = await freshHarness();
	tp.deps = {
		...tp.deps,
		tokens: { ...tp.deps?.tokens, apiTokens: codec, mayHoldApiTokens: policy }
	};
	return tp;
}

function resolve(h: HandlerHarness, raw: string, policy?: ApiTokenHolderPolicy) {
	// The background lastUsedAt write would race the temp-dir cleanup.
	vi.spyOn(h.config.data.apiTokens!, 'touchLastUsed').mockResolvedValue();
	return resolveApiToken(
		new Request('http://selva.test/api/v1/projects', {
			headers: { authorization: `Bearer ${raw}` }
		}),
		{ codec, auth: h.config.auth, data: h.config.data, mayHoldApiTokens: policy }
	);
}

describe('API tokens under a host holder policy', () => {
	it('lets the policy, not manage_api_tokens, decide who mints', async () => {
		const h = await harness(shopAdmins);
		const { alice, bob, acme } = await seedAcme(h);
		const params = { orgId: acme.id };

		const minted = await callHandler(createApiToken, {
			locals: await actAs(h, alice.id),
			params,
			body
		});
		expect(minted.status).toBe(201);

		const refused = await callHandler(createApiToken, {
			locals: await actAs(h, bob.id),
			params,
			body
		});
		expect(refused.status).toBe(403);
	});

	it('keeps manage_api_tokens when the host passes no policy', async () => {
		const h = await harness();
		const { alice, acme } = await seedAcme(h);
		const res = await callHandler(createApiToken, {
			locals: await actAs(h, alice.id),
			params: { orgId: acme.id },
			body
		});
		expect(res.status).toBe(403);
	});

	it('still lists a caller’s own keys after the policy stops holding', async () => {
		const h = await harness(shopAdmins);
		const { alice, acme } = await seedAcme(h);
		const params = { orgId: acme.id };
		const minted = await callHandler(createApiToken, {
			locals: await actAs(h, alice.id),
			params,
			body
		});
		const { token } = minted.json as { token: { id: string } };

		await h.config.data.orgs.updateOrgMemberPermissions(SYSTEM_CONTEXT, acme.id, alice.id, []);
		const listed = await callHandler(listApiTokens, { locals: await actAs(h, alice.id), params });
		expect(listed.status).toBe(200);
		expect((listed.json as { items: { id: string }[] }).items.map((t) => t.id)).toEqual([token.id]);
	});

	it('refuses a minted key at use once its owner no longer qualifies', async () => {
		const h = await harness(shopAdmins);
		const { alice, acme } = await seedAcme(h);
		const minted = await callHandler(createApiToken, {
			locals: await actAs(h, alice.id),
			params: { orgId: acme.id },
			body
		});
		const { secret } = minted.json as { secret: string };
		expect((await resolve(h, secret, shopAdmins)).kind).toBe('ok');

		await h.config.data.orgs.updateOrgMemberPermissions(SYSTEM_CONTEXT, acme.id, alice.id, []);
		expect(await resolve(h, secret, shopAdmins)).toMatchObject({
			kind: 'rejected',
			status: 403,
			code: 'API_TOKEN_HOLDER_REFUSED'
		});
		// Without the policy the resolver doesn't re-check who may hold keys.
		expect((await resolve(h, secret)).kind).toBe('ok');
	});
});
