/** CI-runnable: a delete that changed no row records no deletion. */

import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@selvajs/platform';
import { SupabaseDefinitionStore } from '../SupabaseDefinitionStore.js';
import type { ClientBundle } from '../client.js';

const ctx = { userId: 'u', platformPermissions: [], orgPermissions: [] } as RequestContext;

/** PostgREST answering the soft-delete update with `rows`, recording the query it was sent. */
function bundleUpdating(rows: { guid: string }[]) {
	const calls: unknown[][] = [];
	const chain = {
		update: (patch: unknown) => record('update', patch),
		eq: (col: string, val: unknown) => record('eq', col, val),
		is: (col: string, val: unknown) => record('is', col, val),
		select: async () => ({ data: rows, error: null })
	};
	function record(...call: unknown[]) {
		calls.push(call);
		return chain;
	}
	const from = vi.fn(() => chain);
	const bundle = { serviceClient: { from } } as unknown as ClientBundle;
	return { bundle, calls, from };
}

describe('SupabaseDefinitionStore.delete', () => {
	it.each([
		['changed a row', [{ guid: 'd' }], 1],
		['matched nothing: already deleted, or hidden by RLS', [], 0]
	])('emits definition.deleted only when the update %s', async (_case, rows, emitted) => {
		const emit = vi.fn(async () => {});
		const { bundle } = bundleUpdating(rows);
		await new SupabaseDefinitionStore(bundle, { emit }).delete(ctx, 'd');
		expect(emit).toHaveBeenCalledTimes(emitted);
	});

	it('soft-deletes only that definition, and only while it is live', async () => {
		const { bundle, calls, from } = bundleUpdating([{ guid: 'd' }]);
		await new SupabaseDefinitionStore(bundle, { emit: async () => {} }).delete(ctx, 'd');

		expect(from).toHaveBeenCalledWith('definitions');
		expect(calls).toEqual([
			['update', expect.objectContaining({ deleted_at: expect.any(String), updated_by: 'u' })],
			['eq', 'guid', 'd'],
			['is', 'deleted_at', null]
		]);
	});
});
