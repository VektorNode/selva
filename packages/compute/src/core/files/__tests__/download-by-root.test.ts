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

	it('attaches extra files to the rootless archive', async () => {
		const saved = captureDownloads();

		await downloadFileDataByRoot([fd('a', ''), fd('b', 'ROOT/Panels')], 'files', {
			fileName: 'notes.txt',
			filePath: ''
		});

		const fallback = saved.find((s) => s.name === 'files.zip');
		expect(fallback?.entries).toContain('notes.txt');
		expect(saved.find((s) => s.name === 'ROOT.zip')?.entries).toEqual(['Panels/b.3dm']);
	});

	it('still attaches extras when every file is rooted', async () => {
		// Otherwise they would be dropped for belonging to no root.
		const saved = captureDownloads();

		await downloadFileDataByRoot([fd('a', 'ROOT/Panels')], 'files', {
			fileName: 'notes.txt',
			filePath: ''
		});

		expect(saved[0].entries).toContain('notes.txt');
	});
});
