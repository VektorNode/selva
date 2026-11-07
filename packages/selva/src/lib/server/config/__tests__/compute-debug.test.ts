import { describe, expect, it } from 'vitest';
import { computeDebugMode } from '../settings.js';

// The manifest declares the knob as a string, so "on" in boolean words is this
// reader's rule; the engine, the log level and the admin warning all use it.
describe('computeDebugMode', () => {
	it.each([
		[undefined, 'off'],
		['off', 'off'],
		['no', 'off'],
		['banana', 'off'],
		['on', 'on'],
		['TRUE', 'on'],
		['1', 'on'],
		['verbose', 'verbose'],
		[' Verbose ', 'verbose']
	])('%s reads as %s', (raw, mode) => {
		expect(computeDebugMode({ SELVA_FLAG_COMPUTE_DEBUG: raw })).toBe(mode);
	});
});
