import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@selvajs/platform';
import { SupabaseAuditQuery } from '../SupabaseAuditQuery.js';
import type { ClientBundle } from '../client.js';

const ctx = { userId: 'u' } as unknown as RequestContext;

function bundle() {
	const limit = vi.fn();
	const chain = {
		select: () => chain,
		order: () => chain,
		limit(n: number) {
			limit(n);
			return chain;
		},
		then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
	};
	const client = { serviceClient: { from: () => chain } } as unknown as ClientBundle;
	return { client, limit };
}

describe('SupabaseAuditQuery limit', () => {
	it.each([
		[undefined, 101],
		[0, 101],
		[0.5, 2],
		[1000, 201],
		[10.9, 11]
	])('asks for one extra row past a clamped %s', async (requested, expected) => {
		const { client, limit } = bundle();
		await new SupabaseAuditQuery(client).list(ctx, { limit: requested });
		expect(limit).toHaveBeenCalledWith(expected);
	});
});
