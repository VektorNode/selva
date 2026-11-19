import { describe, expect, it } from 'vitest';
import { resolveValues, type describeInputs } from '../form.js';

type Described = ReturnType<typeof describeInputs>[number];

const input = (id: string, label: string, options?: Record<string, string>): Described =>
	({
		input: { id, nickname: label },
		label,
		item: options
			? { type: 'input', paramId: id, widgetType: 'dropdown', config: { options } }
			: undefined
	}) as unknown as Described;

describe('resolveValues', () => {
	it('maps a dropdown label to its value, and leaves other strings alone', () => {
		const described = [input('a', 'Shape', { Round: 'r', Square: 's' })];
		expect(resolveValues(described, { Shape: 'Round' })).toEqual({ a: 'r' });
		expect(resolveValues(described, { Shape: 'constructor' })).toEqual({ a: 'constructor' });
		expect(resolveValues(described, { Shape: 'toString' })).toEqual({ a: 'toString' });
	});

	it('refuses a label two inputs share, and takes their ids', () => {
		const described = [input('a', 'Width'), input('b', 'Width')];
		expect(() => resolveValues(described, { Width: 3 })).toThrow(/more than one input.*a, b/);
		expect(resolveValues(described, { b: 3 })).toEqual({ b: 3 });
	});
});
