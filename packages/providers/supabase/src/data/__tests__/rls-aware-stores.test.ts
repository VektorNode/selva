/**
 * Stores whose writes depend on what RLS lets the caller reach. A PostgREST write
 * that RLS filters out returns no rows and no error, so these fail on that shape
 * rather than reporting success.
 */

import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@selvajs/platform';
import { SupabaseOrgStore } from '../SupabaseOrgStore.js';
import { SupabaseShareLinkStore } from '../SupabaseShareLinkStore.js';
import type { ClientBundle } from '../client.js';

const CTX = { userId: 'admin' } as unknown as RequestContext;
const LINK_ID = '11111111-1111-4111-8111-111111111111';

function rpcBundle(result: { data: unknown; error: unknown }) {
	const rpc = vi.fn(async () => result);
	const bundle = { forRequest: () => ({ rpc }) } as unknown as ClientBundle;
	return { bundle, rpc };
}

/**
 * `revoke`'s update matches `updated`; the follow-up read sees `existing`. `filters`
 * records each filter the store sent, so a dropped one fails the test.
 */
function revokeBundle(updated: unknown[], existing: unknown) {
	const filters: unknown[][] = [];
	const chain = {
		update: (patch: unknown) => record('update', patch),
		eq: (col: string, val: unknown) => record('eq', col, val),
		is: (col: string, val: unknown) => record('is', col, val),
		select: (columns: string) =>
			columns === 'id'
				? Promise.resolve({ data: updated, error: null })
				: {
						eq: (col: string, val: unknown) => {
							filters.push(['read eq', col, val]);
							return { maybeSingle: async () => ({ data: existing, error: null }) };
						}
					}
	};
	function record(...call: unknown[]) {
		filters.push(call);
		return chain;
	}
	const from = vi.fn(() => chain);
	const bundle = { forRequest: () => ({ from }) } as unknown as ClientBundle;
	return Object.assign(bundle, { filters, from });
}

function recordingEvents() {
	const emit = vi.fn(async () => {});
	return { emit };
}

describe('SupabaseOrgStore.removeOrgMember', () => {
	it('removes through the definer RPC, which reaches private projects', async () => {
		const { bundle, rpc } = rpcBundle({ data: null, error: null });
		const events = recordingEvents();
		await new SupabaseOrgStore(bundle, events).removeOrgMember(CTX, 'org', 'leaver');

		expect(rpc).toHaveBeenCalledWith('remove_org_member', { o: 'org', u: 'leaver' });
		expect(events.emit).toHaveBeenCalledOnce();
	});

	it('maps a missing member to 404 and emits nothing', async () => {
		const error = { code: 'P0002', message: 'Org member not found' };
		const { bundle } = rpcBundle({ data: null, error });
		const events = recordingEvents();
		const store = new SupabaseOrgStore(bundle, events);

		await expect(store.removeOrgMember(CTX, 'org', 'x')).rejects.toMatchObject({ statusCode: 404 });
		expect(events.emit).not.toHaveBeenCalled();
	});

	it('maps a refused caller to 403', async () => {
		const error = { code: '42501', message: 'No permission' };
		const { bundle } = rpcBundle({ data: null, error });
		const store = new SupabaseOrgStore(bundle, recordingEvents());

		await expect(store.removeOrgMember(CTX, 'org', 'x')).rejects.toMatchObject({ statusCode: 403 });
	});
});

describe('SupabaseShareLinkStore.listByOrg', () => {
	const row = {
		id: LINK_ID,
		definition_guid: 'd',
		channel: 'live',
		token_hash: 'secret',
		name: null,
		created_by: 'u',
		created_at: '2026-01-01T00:00:00Z',
		expires_at: null,
		revoked_at: null,
		allow_solve: true,
		max_solves: null,
		solve_count: 0,
		definition_name: 'Roof',
		project_id: 'p',
		project_name: 'Private',
		total_count: 3
	};

	it('reads the roster RPC and pages by its total', async () => {
		const { bundle, rpc } = rpcBundle({ data: [row], error: null });
		const page = await new SupabaseShareLinkStore(bundle).listByOrg(CTX, 'org', { limit: 1 });

		expect(rpc).toHaveBeenCalledWith('org_share_link_roster', {
			o: 'org',
			page_limit: 1,
			page_offset: 0
		});
		expect(page.items[0]).toMatchObject({
			id: LINK_ID,
			definitionName: 'Roof',
			projectId: 'p',
			projectName: 'Private'
		});
		expect(page.items[0]).not.toHaveProperty('tokenHash');
		expect(page.nextCursor).toBe('1');
	});

	it('returns an empty page when the org has no links', async () => {
		const { bundle } = rpcBundle({ data: [], error: null });
		const page = await new SupabaseShareLinkStore(bundle).listByOrg(CTX, 'org');
		expect(page).toEqual({ items: [], nextCursor: undefined });
	});
});

describe('SupabaseShareLinkStore.revoke', () => {
	it('emits once when the update lands', async () => {
		const events = recordingEvents();
		const store = new SupabaseShareLinkStore(revokeBundle([{ id: LINK_ID }], null), events);
		await store.revoke(CTX, LINK_ID);
		expect(events.emit).toHaveBeenCalledOnce();
	});

	it('revokes only that link, and only while it is unrevoked', async () => {
		const bundle = revokeBundle([{ id: LINK_ID }], null);
		await new SupabaseShareLinkStore(bundle, recordingEvents()).revoke(CTX, LINK_ID);

		expect(bundle.from).toHaveBeenCalledWith('share_links');
		expect(bundle.filters).toEqual([
			['update', { revoked_at: expect.any(String) }],
			['eq', 'id', LINK_ID],
			['is', 'revoked_at', null]
		]);
	});

	it('reads back the same link when the update matched nothing', async () => {
		const bundle = revokeBundle([], { revoked_at: '2026-01-01T00:00:00Z' });
		await new SupabaseShareLinkStore(bundle, recordingEvents()).revoke(CTX, LINK_ID);
		expect(bundle.filters).toContainEqual(['read eq', 'id', LINK_ID]);
	});

	it('is a silent no-op on a link already revoked', async () => {
		const events = recordingEvents();
		const existing = { revoked_at: '2026-01-01T00:00:00Z' };
		const store = new SupabaseShareLinkStore(revokeBundle([], existing), events);
		await store.revoke(CTX, LINK_ID);
		expect(events.emit).not.toHaveBeenCalled();
	});

	it('fails when RLS filtered the write out', async () => {
		const events = recordingEvents();
		const store = new SupabaseShareLinkStore(revokeBundle([], { revoked_at: null }), events);
		await expect(store.revoke(CTX, LINK_ID)).rejects.toMatchObject({ statusCode: 403 });
		expect(events.emit).not.toHaveBeenCalled();
	});

	it('fails on a link the caller cannot see', async () => {
		const store = new SupabaseShareLinkStore(revokeBundle([], null), recordingEvents());
		await expect(store.revoke(CTX, LINK_ID)).rejects.toMatchObject({ statusCode: 404 });
	});
});
