import { describe, expect, it } from 'vitest';
import { getDefaultValue } from '../index.js';

describe('getDefaultValue', () => {
	it('maps each paramType to its zero value', () => {
		expect(getDefaultValue('number')).toBe(0);
		expect(getDefaultValue('integer')).toBe(0);
		expect(getDefaultValue('boolean')).toBe(false);
		expect(getDefaultValue('text')).toBe('');
	});

	it('falls through to null for unrecognized types, so callers decide', () => {
		expect(getDefaultValue('valueList')).toBeNull();
		expect(getDefaultValue('generic')).toBeNull();
		expect(getDefaultValue('')).toBeNull();
	});
});
