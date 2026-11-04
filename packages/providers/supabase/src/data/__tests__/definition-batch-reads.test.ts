/** The batch reads page past PostgREST's row cap and keep each definition's versions in order. */

import { describe, expect, it } from 'vitest';
import type { RequestContext } from '@selvajs/platform';
import { SupabaseDefinitionStore } from '../SupabaseDefinitionStore.js';
import type { ClientBundle } from '../client.js';

const ctx = { userId: 'u' } as unknown as RequestContext;

/** A query builder over `rows`, answering `range` slices and recording its filters. */
function bundleOver(rows: Record<string, unknown>[]) {
	const calls: { in?: [string, string[]]; is?: [string, unknown]; ranges: [number, number][] } = {
		ranges: []
	};
	const chain = {
		select: () => chain,
		order: () => chain,
		in(column: string, values: string[]) {
			calls.in = [column, values];
			return chain;
		},
		is(column: string, value: unknown) {
			calls.is = [column, value];
			return Promise.resolve({ data: rows, error: null });
		},
		range(from: number, to: number) {
			calls.ranges.push([from, to]);
			return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
		}
	};
	const bundle = { forRequest: () => ({ from: () => chain }) } as unknown as ClientBundle;
	return { bundle, calls };
}

function versionRow(definition: string, n: number) {
	return {
		id: `${definition}-v${n}`,
		definition_guid: definition,
		version_number: n,
		file_ext: 'gh',
		file_key: `k/${n}`,
		original_filename: null,
		uploaded_by: 'u',
		uploaded_at: '2026-01-01T00:00:00Z'
	};
}

describe('SupabaseDefinitionStore batch reads', () => {
	it('getDefinitionsFor asks once for live rows of the distinct guids', async () => {
		const { bundle, calls } = bundleOver([]);
		await new SupabaseDefinitionStore(bundle).getDefinitionsFor(ctx, ['a', 'b', 'a']);
		expect(calls.in).toEqual(['guid', ['a', 'b']]);
		expect(calls.is).toEqual(['deleted_at', null]);
	});

	it('listVersionsFor reads every page and keys each definition, empty ones included', async () => {
		// Ordered as the query orders them: by definition, newest first.
		const rows = [
			...Array.from({ length: 1200 }, (_, i) => versionRow('a', 1200 - i)),
			versionRow('b', 1)
		];
		const { bundle, calls } = bundleOver(rows);
		const byDefinition = await new SupabaseDefinitionStore(bundle).listVersionsFor(ctx, [
			'a',
			'b',
			'c'
		]);
		expect(calls.ranges).toEqual([
			[0, 999],
			[1000, 1999]
		]);
		expect(byDefinition.get('a')).toHaveLength(1200);
		expect(byDefinition.get('a')?.[0]?.versionNumber).toBe(1200);
		expect(byDefinition.get('b')?.map((v) => v.id)).toEqual(['b-v1']);
		expect(byDefinition.get('c')).toEqual([]);
	});

	it('listVersionsFor reads nothing for no ids', async () => {
		const { bundle, calls } = bundleOver([]);
		expect((await new SupabaseDefinitionStore(bundle).listVersionsFor(ctx, [])).size).toBe(0);
		expect(calls.ranges).toEqual([]);
	});
});
