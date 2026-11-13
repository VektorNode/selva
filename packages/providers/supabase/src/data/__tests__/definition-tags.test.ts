/** `definitions.tags` is `text[] not null`, so a cleared patch has to reach it as an empty array. */

import { describe, expect, it } from 'vitest';
import type { RequestContext } from '@selvajs/platform';
import { SupabaseDefinitionStore } from '../SupabaseDefinitionStore.js';
import type { ClientBundle } from '../client.js';

function recordingBundle() {
	const updates: Record<string, unknown>[] = [];
	const chain = {
		update(row: Record<string, unknown>) {
			updates.push(row);
			return chain;
		},
		eq: () => chain,
		is: () => chain,
		select: async () => ({ data: [{ guid: 'g' }], error: null })
	};
	const client = { from: () => chain };
	const bundle = { serviceClient: client } as unknown as ClientBundle;
	return { bundle, updates };
}

describe('SupabaseDefinitionStore.update tags', () => {
	it('writes an empty array when the patch clears tags', async () => {
		const { bundle, updates } = recordingBundle();
		const store = new SupabaseDefinitionStore(bundle);

		await store.update({ userId: 'u' } as unknown as RequestContext, 'g', { tags: null });

		expect(updates[0].tags).toEqual([]);
	});
});
