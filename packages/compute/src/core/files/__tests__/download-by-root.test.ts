import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadFileDataByRoot } from '../handle-files';
import type { FileData } from '../types';

const fd = (fileName: string, subFolder: string): FileData => ({
	fileName,
	data: 'x',
	fileType: '.3dm',
	isBase64Encoded: false,
	subFolder
});

/**
 * Captures what each archive would be called and what it would contain, by stubbing the DOM
 * anchor `saveFile` clicks. Entry names come from fflate's zip input, so this pins the archive
 * layout rather than just the call arguments.
 */
const captureDownloads = () => {
	const saved: Array<{ name: string; entries: string[] }> = [];
	let lastEntries: string[] = [];

	// `additionalFiles` are fetched over HTTP and dropped on failure, so they need a live fetch
	// to reach the archive at all.
	vi.stubGlobal('fetch', async () => ({
		ok: true,
		arrayBuffer: async () => new ArrayBuffer(4)
	}));
	vi.stubGlobal('Blob', class {} as unknown as typeof Blob);
	vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
	vi.stubGlobal('document', {
		createElement: () => ({
			set download(value: string) {
				saved.push({ name: value, entries: lastEntries });
			},
			href: '',
			style: {},
			click: () => {},
			remove: () => {}
		}),
		body: { appendChild: () => {}, removeChild: () => {} }
	});

	vi.doMock('fflate', () => ({
		strToU8: (s: string) => new Uint8Array(s.length),
		zip: (data: Record<string, Uint8Array>, _o: unknown, cb: (e: null, d: Uint8Array) => void) => {
			lastEntries = Object.keys(data);
			cb(null, new Uint8Array(0));
		}
	}));

	return saved;
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.doUnmock('fflate');
	vi.resetModules();
});

describe('downloadFileDataByRoot', () => {
	it('names the archive after the root and drops it from the entry paths', async () => {
		const saved = captureDownloads();

		await downloadFileDataByRoot([fd('MainBrep', 'ROOT/Panels')], 'files');

		expect(saved).toHaveLength(1);
		expect(saved[0].name).toBe('ROOT.zip');
		expect(saved[0].entries).toEqual(['Panels/MainBrep.3dm']);
	});

	it('names the archive after a lone root segment, leaving the files at its top', async () => {
		const saved = captureDownloads();

		await downloadFileDataByRoot([fd('a', 'Panels')], 'files');

		expect(saved).toEqual([{ name: 'Panels.zip', entries: ['a.3dm'] }]);
	});

	it('produces one archive per distinct root', async () => {
		const saved = captureDownloads();

		await downloadFileDataByRoot(
			[fd('MainBrep', 'ROOT/Panels'), fd('SecondBrep', 'OTHERROOT/Panels')],
			'files'
		);

		expect(saved.map((s) => s.name)).toEqual(['ROOT.zip', 'OTHERROOT.zip']);
		expect(saved[0].entries).toEqual(['Panels/MainBrep.3dm']);
		expect(saved[1].entries).toEqual(['Panels/SecondBrep.3dm']);
	});

	it('keeps files sharing a root in one archive', async () => {
		const saved = captureDownloads();

		await downloadFileDataByRoot([fd('a', 'ROOT/Panels'), fd('b', 'ROOT/Frames')], 'files');

		expect(saved).toHaveLength(1);
		expect(saved[0].entries).toEqual(['Panels/a.3dm', 'Frames/b.3dm']);
	});

	it('falls back to the given name when no file has a root', async () => {
		const saved = captureDownloads();

		await downloadFileDataByRoot([fd('a', ''), fd('b', '')], 'my-widget');

		expect(saved).toHaveLength(1);
		expect(saved[0].name).toBe('my-widget.zip');
		expect(saved[0].entries).toEqual(['a.3dm', 'b.3dm']);
	});

	it('sanitizes a root that is unsafe as a filename', async () => {
		const saved = captureDownloads();

		await downloadFileDataByRoot([fd('a', 'RE:VISION*1/Panels')], 'files');

		expect(saved[0].name).toBe('RE_VISION_1.zip');
	});

	it.each([
		['the rootless archive', [fd('a', ''), fd('b', 'ROOT/Panels')], 'files.zip'],
		['the first archive when all are rooted', [fd('a', 'ROOT/A'), fd('b', 'OTHER/B')], 'ROOT.zip']
	])('attaches extras to %s', async (_where, files, carrier) => {
		const saved = captureDownloads();

		await downloadFileDataByRoot(files, 'files', { fileName: 'notes.txt', filePath: '' });

		expect(saved).toHaveLength(2);
		for (const { name, entries } of saved) {
			expect(entries.includes('notes.txt')).toBe(name === carrier);
		}
	});

	it('still produces one archive for extras with no files', async () => {
		const saved = captureDownloads();

		await downloadFileDataByRoot([], 'files', { fileName: 'notes.txt', filePath: '' });

		expect(saved).toEqual([{ name: 'files.zip', entries: ['notes.txt'] }]);
	});

	it('hands every archive to a supplied saveBlob instead of clicking an anchor', async () => {
		const anchorSaves = captureDownloads();
		const handed: string[] = [];

		await downloadFileDataByRoot([fd('a', 'ROOT/Panels'), fd('b', '')], 'files', null, {
			saveBlob: async (_blob, fileName) => {
				handed.push(fileName);
			}
		});

		expect(handed.sort()).toEqual(['ROOT.zip', 'files.zip']);
		expect(anchorSaves).toEqual([]);
	});
});
