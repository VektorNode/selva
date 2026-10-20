import { describe, expect, it } from 'vitest';
import { formatCount, formatMessage, messagesFor, withOverrides } from '../messages';

describe('withOverrides', () => {
	it('replaces only the keys a host sets, and an undefined entry keeps the catalog string', () => {
		const de = messagesFor('de');
		const merged = withOverrides(de, { calculate: 'Neu berechnen', upToDate: undefined });
		expect(merged.calculate).toBe('Neu berechnen');
		expect(merged.upToDate).toBe(de.upToDate);
		expect(merged.solving).toBe(de.solving);
	});

	it('leaves the shared catalog untouched', () => {
		withOverrides(messagesFor('en'), { calculate: 'Run' });
		expect(messagesFor('en').calculate).toBe('Calculate');
	});
});

describe('formatMessage / formatCount', () => {
	it('fills every placeholder and leaves unknown ones as written', () => {
		expect(formatMessage('{a} and {a}, not {b}', { a: 1 })).toBe('1 and 1, not {b}');
	});

	it('picks the singular only for exactly one', () => {
		expect(formatCount(1, '{count} file', '{count} files')).toBe('1 file');
		expect(formatCount(0, '{count} file', '{count} files')).toBe('0 files');
		expect(formatCount(2, '{count} file', '{count} files')).toBe('2 files');
	});
});
