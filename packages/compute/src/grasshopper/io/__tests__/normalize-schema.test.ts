import { describe, expect, it } from 'vitest';
import { normalizeInputSchema, normalizeOutputSchema } from '@/grasshopper/io/normalize-schema';
import { processInputWithError } from '@/grasshopper/io/input/input-processors';

describe('normalizeInputSchema — missing wire fields', () => {
	it('fills required fields with honest defaults instead of undefined-behind-a-cast', () => {
		const schema = normalizeInputSchema({});
		expect(schema.id).toBe('');
		expect(schema.name).toBe('');
		expect(schema.description).toBe('');
		expect(schema.paramType).toBe('');
		expect(schema.treeAccess).toBe(false);
		expect(schema.atLeast).toBe(1);
		expect(schema.atMost).toBe(1);
		expect(schema.minimum).toBeNull();
		expect(schema.maximum).toBeNull();
		expect(schema.groupName).toBeNull();
	});

	it('a missing paramType surfaces as a per-input parse error downstream', () => {
		const { input, errors } = processInputWithError(normalizeInputSchema({ name: 'X' }));
		expect(errors).toMatchObject([{ code: 'VALIDATION_ERROR', inputName: 'X' }]);
		// Safe fallback still produced (geometry-shaped, matching unknown types).
		expect(input.paramType).toBe('Geometry');
	});

	it('preserves null vs empty-string groupName', () => {
		expect(normalizeInputSchema({ groupName: null }).groupName).toBeNull();
		expect(normalizeInputSchema({}).groupName).toBeNull();
		expect(normalizeInputSchema({ groupName: '' }).groupName).toBe('');
		expect(normalizeInputSchema({ groupName: 'Dims' }).groupName).toBe('Dims');
	});

	it('drops a non-numeric stepSize instead of passing it through typed as number', () => {
		expect(normalizeInputSchema({ stepSize: 'abc' }).stepSize).toBeUndefined();
		expect(normalizeInputSchema({ stepSize: Number.NaN }).stepSize).toBeUndefined();
		expect(normalizeInputSchema({ stepSize: 0.5 }).stepSize).toBe(0.5);
	});

	it('still reads PascalCase wire fields case-insensitively', () => {
		const schema = normalizeInputSchema({
			Name: 'Radius',
			ParamType: 'Number',
			TreeAccess: true,
			AtLeast: 2,
			AtMost: 3,
			StepSize: 0.5
		});
		expect(schema.name).toBe('Radius');
		expect(schema.paramType).toBe('Number');
		expect(schema.treeAccess).toBe(true);
		expect(schema.atLeast).toBe(2);
		expect(schema.atMost).toBe(3);
		expect(schema.stepSize).toBe(0.5);
	});
});

describe('normalizeOutputSchema — missing wire fields', () => {
	it('fills required fields with empty strings instead of undefined-behind-a-cast', () => {
		const schema = normalizeOutputSchema({});
		expect(schema.name).toBe('');
		expect(schema.paramType).toBe('');
		expect(schema.id).toBe('');
		expect(schema.nickname).toBeNull();
	});
});
