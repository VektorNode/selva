/** CI-runnable: stubs GoTrue's admin `listUsers` to see what the provider asks it for. */

import { describe, it, expect, vi } from 'vitest';
import { MAX_PAGE_LIMIT, DEFAULT_PAGE_LIMIT } from '@selvajs/platform';
import { SupabaseAuthProvider } from '../SupabaseAuthProvider.js';

/** GoTrue's stub answers every call with a full page, so there is always a next one. */
function providerWithStub() {
	const provider = new SupabaseAuthProvider({
		supabaseUrl: 'https://example.supabase.co',
		anonKey: 'anon-key',
		serviceRoleKey: 'service-key'
	});
	const listUsers = vi.fn(async ({ perPage }: { page: number; perPage: number }) => ({
		data: { users: Array.from({ length: perPage }, (_, i) => ({ id: `u${i}` })) },
		error: null
	}));
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the admin client is private
	(provider as any).admin.auth.admin.listUsers = listUsers;
	return { provider, listUsers };
}

describe('SupabaseAuthProvider.listUsers', () => {
	it.each([
		[5000, MAX_PAGE_LIMIT],
		[0, 1],
		[-1, 1],
		[undefined, DEFAULT_PAGE_LIMIT]
	])('asks GoTrue for a page GoTrue accepts when the limit is %s', async (limit, perPage) => {
		const { provider, listUsers } = providerWithStub();
		await provider.listUsers({ limit });
		expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage });
	});

	it('reads a junk cursor as the first page and points at the second', async () => {
		const { provider, listUsers } = providerWithStub();
		const page = await provider.listUsers({ cursor: 'junk' });
		expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: DEFAULT_PAGE_LIMIT });
		expect(page?.nextCursor).toBe('2');
	});
});
