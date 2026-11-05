import { describe, expect, it } from 'vitest';
import { normalizeInputSchema } from '@/grasshopper/io/normalize-schema';
import { processInputWithError } from '@/grasshopper/io/input/input-processors';

describe('normalizeInputSchema — missing wire fields', () => {
	// The parsers read atMost to choose between a list and a scalar fallback.
	it('defaults a missing atMost to 1', () => {
		expect(normalizeInputSchema({}).atMost).toBe(1);
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
});
