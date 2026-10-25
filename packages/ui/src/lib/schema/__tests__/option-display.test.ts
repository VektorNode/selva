import { describe, expect, it } from 'vitest';
import type { OptionAsset } from '@selvajs/schemas';
import { optionGlyph, resolveOptionDisplay } from '../option-display';

describe('resolveOptionDisplay', () => {
	it('keeps a segmented list that fits', () => {
		expect(resolveOptionDisplay('segmented', 4)).toBe('segmented');
	});

	it('shows a segmented list as a dropdown once it has too many options to fit', () => {
		expect(resolveOptionDisplay('segmented', 7)).toBe('dropdown');
	});

	it('keeps tiles and checklist regardless of count', () => {
		expect(resolveOptionDisplay('tiles', 12)).toBe('tiles');
		expect(resolveOptionDisplay('checklist', 12)).toBe('checklist');
	});

	it('shows a mode it does not know, or none, as a dropdown', () => {
		expect(resolveOptionDisplay('carousel', 3)).toBe('dropdown');
		expect(resolveOptionDisplay(undefined, 3)).toBe('dropdown');
	});
});

describe('optionGlyph', () => {
	const assets: Record<string, OptionAsset> = {
		icon1: { d: 'M3 3h18' },
		img1: { img: 'data:image/webp;base64,UklGRg==' },
		svg1: { img: 'data:image/svg+xml;base64,PHN2Zz4=' }
	};

	it('gives the icon path for an option with an icon', () => {
		expect(optionGlyph({ icon: 'icon1' }, assets, 'icon')).toEqual({ kind: 'icon', d: 'M3 3h18' });
	});

	it('prefers the image where images are wanted, and falls back to the icon', () => {
		expect(optionGlyph({ icon: 'icon1', image: 'img1' }, assets, 'image')).toEqual({
			kind: 'image',
			src: 'data:image/webp;base64,UklGRg=='
		});
		expect(optionGlyph({ icon: 'icon1' }, assets, 'image')).toEqual({ kind: 'icon', d: 'M3 3h18' });
	});

	it('ignores an image where only icons are shown', () => {
		expect(optionGlyph({ image: 'img1' }, assets, 'icon')).toBeUndefined();
	});

	it('never hands out an image that is not a raster data URI', () => {
		expect(optionGlyph({ image: 'svg1' }, assets, 'image')).toBeUndefined();
	});

	it('gives nothing for a missing entry or a dangling asset', () => {
		expect(optionGlyph(undefined, assets, 'icon')).toBeUndefined();
		expect(optionGlyph({ icon: 'gone' }, assets, 'icon')).toBeUndefined();
		expect(optionGlyph({ icon: 'icon1' }, undefined, 'icon')).toBeUndefined();
	});
});
