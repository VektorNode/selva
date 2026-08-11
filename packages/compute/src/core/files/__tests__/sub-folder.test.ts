import { describe, expect, it } from 'vitest';
import { groupFilesByRoot, subFolderSegments } from '../sub-folder';
import type { FileData } from '../types';

const fd = (fileName: string, subFolder: string): FileData => ({
	fileName,
	data: '',
	fileType: '.3dm',
	isBase64Encoded: false,
	subFolder
});

/**
 * The `Sub Folder` root names the archive rather than becoming a folder inside it, so files with
 * different roots have to be split into separate downloads.
 */
/**
 * A folder tree has to split on the same boundaries the archive does — splitting on `/` alone
 * renders `Main::Panels` as a single folder literally named with the separator.
 */
describe('subFolderSegments', () => {
	it('splits on ::', () => {
		expect(subFolderSegments('Main::Panels')).toEqual(['Main', 'Panels']);
	});

	it('splits on slashes', () => {
		expect(subFolderSegments('Main/Panels')).toEqual(['Main', 'Panels']);
		expect(subFolderSegments('Main\\Panels')).toEqual(['Main', 'Panels']);
	});

	it('handles mixed separators', () => {
		expect(subFolderSegments('A::B/C')).toEqual(['A', 'B', 'C']);
	});

	it('trims and drops empty segments', () => {
		expect(subFolderSegments(' Main :: Panels ')).toEqual(['Main', 'Panels']);
		expect(subFolderSegments('Main::::Panels')).toEqual(['Main', 'Panels']);
	});

	it('returns nothing for a blank value', () => {
		expect(subFolderSegments('')).toEqual([]);
		expect(subFolderSegments(undefined)).toEqual([]);
	});
});

describe('groupFilesByRoot', () => {
	it('puts rootless files in one unnamed group', () => {
		const groups = groupFilesByRoot([fd('a', ''), fd('b', '')]);

		expect(groups).toHaveLength(1);
		expect(groups[0].root).toBe('');
		expect(groups[0].files.map((f) => f.fileName)).toEqual(['a', 'b']);
	});

	it('groups files sharing a root together', () => {
		const groups = groupFilesByRoot([fd('a', 'ROOT::Panels'), fd('b', 'ROOT::Frames')]);

		expect(groups).toHaveLength(1);
		expect(groups[0].root).toBe('ROOT');
		expect(groups[0].files).toHaveLength(2);
	});

	it('splits distinct roots into separate groups', () => {
		const groups = groupFilesByRoot([fd('a', 'ROOT::Panels'), fd('b', 'OTHERROOT::Panels')]);

		expect(groups.map((g) => g.root)).toEqual(['ROOT', 'OTHERROOT']);
		expect(groups.every((g) => g.files.length === 1)).toBe(true);
	});

	it('treats a single-segment subFolder as a root', () => {
		expect(groupFilesByRoot([fd('a', 'Panels')])[0].root).toBe('Panels');
	});

	it('separates rooted from rootless files', () => {
		const groups = groupFilesByRoot([fd('a', ''), fd('b', 'ROOT::Panels')]);

		expect(groups.map((g) => g.root)).toEqual(['', 'ROOT']);
	});

	it('accepts slashes as separators', () => {
		const groups = groupFilesByRoot([fd('a', 'ROOT/Panels'), fd('b', 'ROOT\\Frames')]);

		expect(groups).toHaveLength(1);
		expect(groups[0].root).toBe('ROOT');
	});

	it('preserves encounter order', () => {
		const groups = groupFilesByRoot([fd('a', 'B::x'), fd('b', 'A::x'), fd('c', 'B::y')]);

		expect(groups.map((g) => g.root)).toEqual(['B', 'A']);
		expect(groups[0].files.map((f) => f.fileName)).toEqual(['a', 'c']);
	});

	it('ignores surrounding whitespace in a root', () => {
		const groups = groupFilesByRoot([fd('a', ' ROOT :: Panels'), fd('b', 'ROOT::Frames')]);

		expect(groups).toHaveLength(1);
		expect(groups[0].root).toBe('ROOT');
	});

	it('returns nothing for no files', () => {
		expect(groupFilesByRoot([])).toEqual([]);
	});
});
