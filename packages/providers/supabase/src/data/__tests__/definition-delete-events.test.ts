/** CI-runnable: a delete that changed no row records no deletion. */

import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@selvajs/platform';
import { SupabaseDefinitionStore } from '../SupabaseDefinitionStore.js';
import type { ClientBundle } from '../client.js';

const ctx = { userId: 'u', platformPermissions: [], orgPermissions: [] } as RequestContext;

/** PostgREST answering the soft-delete update with `rows`. */
function bundleUpdating(rows: { guid: string }[]) {
	const chain = {
		update: () => chain,
		eq: () => chain,
		is: () => chain,
		select: async () => ({ data: rows, error: null })
	};
	return { forRequest: () => ({ from: () => chain }) } as unknown as ClientBundle;
}

describe('SupabaseDefinitionStore.delete', () => {
	it.each([
		['changed a row', [{ guid: 'd' }], 1],
		['matched nothing: already deleted, or hidden by RLS', [], 0]
	])('emits definition.deleted only when the update %s', async (_case, rows, emitted) => {
		const emit = vi.fn(async () => {});
		await new SupabaseDefinitionStore(bundleUpdating(rows), { emit }).delete(ctx, 'd');
		expect(emit).toHaveBeenCalledTimes(emitted);
	});
});
