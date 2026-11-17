import { describe, expect, it } from 'vitest';
import { SYSTEM_CONTEXT, type IBindingResolver } from '@selvajs/platform';
import type { UISchema } from '@selvajs/schemas';
import { resolveBoundValues } from '../bound-values.js';

const schema = {
	inputs: [],
	outputs: [],
	layout: {
		type: 'flat',
		groups: [
			{
				items: [
					{ type: 'input', paramId: 'a', source: { kind: 'server', key: 'job.geometry' } },
					{ type: 'input', paramId: 'b', source: { kind: 'server', key: 'job.geometry' } },
					{ type: 'input', paramId: 'c', source: { kind: 'server', key: 'job.missing' } },
					{ type: 'input', paramId: 'd', source: { kind: 'server' } },
					{ type: 'input', paramId: 'e', source: { kind: 'client', key: 'job.geometry' } }
				]
			}
		]
	}
} as unknown as UISchema;

describe('resolveBoundValues', () => {
	it('resolves each server key once and maps it to every input that names it', async () => {
		const calls: { keys: readonly string[]; scope: unknown }[] = [];
		const resolver: IBindingResolver = {
			async resolve(_ctx, keys, scope) {
				calls.push({ keys, scope });
				return new Map([['job.geometry', 'mesh']]);
			}
		};
		const values = await resolveBoundValues(schema, resolver, SYSTEM_CONTEXT, { jobId: 'j1' });
		expect(values).toEqual({ a: 'mesh', b: 'mesh' });
		expect(calls).toEqual([{ keys: ['job.geometry', 'job.missing'], scope: { jobId: 'j1' } }]);
	});

	it('does not call the resolver when no input is server-sourced', async () => {
		const resolver: IBindingResolver = {
			resolve: () => Promise.reject(new Error('called'))
		};
		const plain = { ...schema, layout: { type: 'flat', groups: [] } } as unknown as UISchema;
		expect(await resolveBoundValues(plain, resolver, SYSTEM_CONTEXT)).toEqual({});
	});
});
