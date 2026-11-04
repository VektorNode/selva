import { describe, expect, it } from 'vitest';
import {
	contrastRatio,
	hexToHsv,
	hexToRgb,
	hsvToHex,
	normalizeHex,
	rgbToHex
} from '../color-space';

describe('normalizeHex', () => {
	it('expands shorthand, lowercases and adds the hash', () => {
		expect(normalizeHex('#ABC')).toBe('#aabbcc');
		expect(normalizeHex('2F6FD6')).toBe('#2f6fd6');
		expect(normalizeHex('  #2f6fd6 ')).toBe('#2f6fd6');
	});

	it('rejects anything that is not 3 or 6 hex digits', () => {
		expect(normalizeHex('')).toBeNull();
		expect(normalizeHex('#12')).toBeNull();
		expect(normalizeHex('#12345')).toBeNull();
		expect(normalizeHex('#gggggg')).toBeNull();
		expect(normalizeHex('#2f6fd680')).toBeNull();
	});
});

describe('hex ↔ rgb ↔ hsv', () => {
	it('round-trips every primary and the grays', () => {
		for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#808080']) {
			expect(hsvToHex(hexToHsv(hex)!)).toBe(hex);
		}
	});

	it('round-trips an arbitrary color', () => {
		expect(hsvToHex(hexToHsv('#2f6fd6')!)).toBe('#2f6fd6');
	});

	it('reads hue, saturation and value', () => {
		expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
		expect(hexToHsv('#00ff00')!.h).toBe(120);
		expect(hexToHsv('#0000ff')!.h).toBe(240);
		expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
	});

	it('clamps channels when writing hex', () => {
		expect(rgbToHex({ r: 300, g: -5, b: 127.6 })).toBe('#ff0080');
		expect(hexToRgb('#102030')).toEqual({ r: 16, g: 32, b: 48 });
	});
});

describe('contrastRatio', () => {
	it('is 21 for black on white and 1 for identical colors', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
	});

	it('returns null for a non-hex input', () => {
		expect(contrastRatio('red', '#ffffff')).toBeNull();
	});
});
