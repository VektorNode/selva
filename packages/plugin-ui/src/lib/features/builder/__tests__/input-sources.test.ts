import { describe, expect, it } from 'vitest';
import type { UISchema } from '@selvajs/schemas';
import { listSourcedInputs } from '../input-sources';

const input = (id: string, source?: unknown) =>
	({
		id,
		type: 'input',
		paramId: id,
		widgetType: 'number',
		...(source ? { source } : {})
	}) as never;
const output = (id: string) => ({ id, type: 'output', paramId: id, widgetType: 'text' }) as never;
const group = (items: unknown[]) => ({ id: 'g', label: 'g', items, order: 0 }) as never;

describe('listSourcedInputs', () => {
	it('lists client and server inputs with their tab, skipping form inputs and outputs', () => {
		const schema = {
			inputs: [],
			outputs: [],
			layout: {
				type: 'tabbed',
				tabs: [
					{ id: 't1', groups: [group([input('a'), input('b', { kind: 'server', key: 'x' })])] },
					{
						id: 't2',
						groups: [
							group([input('c', { kind: 'user' }), output('d'), input('e', { kind: 'client' })])
						]
					}
				]
			}
		} as unknown as UISchema;

		expect(
			listSourcedInputs(schema).map(({ tabId, item, kind }) => [tabId, item.id, kind])
		).toEqual([
			['t1', 'b', 'server'],
			['t2', 'e', 'client']
		]);
	});

	it("reports a flat layout's inputs under the empty tab id", () => {
		const schema = {
			inputs: [],
			outputs: [],
			layout: { type: 'flat', groups: [group([input('a', { kind: 'server' })])] }
		} as unknown as UISchema;

		expect(listSourcedInputs(schema)).toEqual([
			{ tabId: '', groupId: 'g', item: expect.objectContaining({ id: 'a' }), kind: 'server' }
		]);
	});
});
