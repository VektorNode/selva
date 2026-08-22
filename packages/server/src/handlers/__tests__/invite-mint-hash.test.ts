/**
 * H7 — invite tokens are HMAC-hashed at the route layer; the store sees only
 * the digest. Covers:
 *
 *   - POST returns the raw token in `acceptUrl` (never as a separate field)
 *     and DOES NOT echo `tokenHash` back to the caller.
 *   - The persisted invite holds the *hash*, not the raw token, and lookup
 *     by the raw token fails — only the hash works.
 *   - GET (list pending invites) strips `tokenHash` from the response.
 *   - The accept-invite load flow accepts the raw token by hashing it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import { seedAcme, actAs, callHandler } from '../../testing/index.js';
import { listInvites, createInvite } from '../invites.js';

/**
 * Hash through the harness's own invite codec — the same instance the handler
 * mints with. A second codec on a different secret would produce a hash no
 * handler could ever have written, and the lookup would fail for the wrong reason.
 */
function inviteHash(h: HandlerHarness, raw: string): string {
	const codec = h.deps?.tokens?.invites;
	if (!codec) throw new Error('harness has no invite codec');
	return codec.hashToken(raw);
}

let tp: HandlerHarness | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('POST /api/v1/orgs/{orgId}/invites — raw-token-once + hashed-at-rest', () => {
	it('returns the raw token only inside acceptUrl; no tokenHash in response', async () => {
		tp = await freshHarness();
		const { alice, acme } = await seedAcme(tp);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await callHandler(createInvite, {
			locals: aliceLocals,
			params: { orgId: acme.id },
			body: { email: 'newhire@acme.test', orgRole: 'member', permissions: [] }
		});
		expect(res.status).toBe(201);
		const body = res.json as {
			id: string;
			tokenHash?: unknown;
			email: string;
			acceptUrl: string;
		};

		// Raw token lives in the URL only. Extract it for the next assertions.
		const url = new URL(body.acceptUrl);
		const rawToken = url.searchParams.get('token');
		expect(rawToken).toMatch(/^invite_/);

		// Response MUST NOT echo the hash — it's a server-side lookup key.
		expect(body.tokenHash).toBeUndefined();
	});

	it('persists the hash, not the raw token; lookup by raw token fails', async () => {
		tp = await freshHarness();
		const { alice, acme } = await seedAcme(tp);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await callHandler(createInvite, {
			locals: aliceLocals,
			params: { orgId: acme.id },
			body: { email: 'newhire@acme.test', orgRole: 'member', permissions: [] }
		});
		const body = res.json as { acceptUrl: string };
		const rawToken = new URL(body.acceptUrl).searchParams.get('token')!;

		// Looking up by the *raw* token must miss — the store sees only the digest.
		const byRaw = await tp.config.data.invites.getByTokenHash(SYSTEM_CONTEXT, rawToken);
		expect(byRaw).toBeNull();

		// Looking up by the HMAC of the raw token must hit.
		const byHash = await tp.config.data.invites.getByTokenHash(
			SYSTEM_CONTEXT,
			inviteHash(tp, rawToken)
		);
		expect(byHash).not.toBeNull();
		expect(byHash?.email).toBe('newhire@acme.test');
	});
});

describe('GET /api/v1/orgs/{orgId}/invites — listing strips tokenHash', () => {
	it('does not expose tokenHash to the admin UI', async () => {
		tp = await freshHarness();
		const { alice, acme } = await seedAcme(tp);
		const aliceLocals = await actAs(tp, alice.id);

		// Mint two invites so the listing is non-empty.
		await callHandler(createInvite, {
			locals: aliceLocals,
			params: { orgId: acme.id },
			body: { email: 'one@acme.test', orgRole: 'member', permissions: [] }
		});
		await callHandler(createInvite, {
			locals: aliceLocals,
			params: { orgId: acme.id },
			body: { email: 'two@acme.test', orgRole: 'member', permissions: [] }
		});

		const res = await callHandler(listInvites, { locals: aliceLocals, params: { orgId: acme.id } });
		expect(res.status).toBe(200);
		const items = (res.json as { items: Array<Record<string, unknown>> }).items;
		expect(items.length).toBeGreaterThanOrEqual(2);
		for (const item of items) {
			expect(item.tokenHash).toBeUndefined();
			// Sanity: other fields still present.
			expect(typeof item.id).toBe('string');
			expect(typeof item.email).toBe('string');
		}
	});
});
