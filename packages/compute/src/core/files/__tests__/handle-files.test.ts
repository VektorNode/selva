import { describe, it, expect, vi, afterEach } from 'vitest';

import { extractFilesFromComputeResponse } from '../handle-files';
import { base64ByteArray } from '@/core/utils/encoding';
import type { FileData, FileBaseInfo } from '../types';

const fd = (over: Partial<FileData> = {}): FileData => ({
	fileName: 'model',
	data: 'hello',
	fileType: '.txt',
	isBase64Encoded: false,
	subFolder: '',
	...over
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('extractFilesFromComputeResponse — decode half', () => {
	it('passes plain-text items through unchanged', async () => {
		const [file] = await extractFilesFromComputeResponse([fd({ data: 'plain text' })]);
		expect(file).toMatchObject({
			fileName: 'model.txt',
			content: 'plain text',
			path: 'model.txt'
		});
	});

	it('decodes base64 items to binary', async () => {
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const [file] = await extractFilesFromComputeResponse([
			fd({ data: base64ByteArray(bytes), isBase64Encoded: true, fileType: '.bin' })
		]);
		expect(file.content).toBeInstanceOf(Uint8Array);
		expect(Array.from(file.content as Uint8Array)).toEqual([1, 2, 3, 4]);
	});

	it('prefixes the archive path with subFolder when present', async () => {
		const [file] = await extractFilesFromComputeResponse([
			fd({ subFolder: 'nested/dir', fileName: 'a', fileType: '.json' })
		]);
		expect(file.path).toBe('nested/dir/a.json');
		expect(file.fileName).toBe('a.json');
	});

	it('skips items with no usable data', async () => {
		const files = await extractFilesFromComputeResponse([fd({ data: '' }), fd({ data: 'kept' })]);
		expect(files).toHaveLength(1);
		expect(files[0].content).toBe('kept');
	});
});

/**
 * Zip-slip defense (issue 94): `subFolder`/`fileName`/`fileType` are server-controlled;
 * traversal segments, absolute paths, and drive letters must never survive into archive paths.
 */
describe('extractFilesFromComputeResponse — archive path sanitization', () => {
	it('strips ".." traversal segments from subFolder', async () => {
		const [file] = await extractFilesFromComputeResponse([
			fd({ subFolder: '../../..', fileName: 'evil', fileType: '.txt' })
		]);
		expect(file.path).toBe('evil.txt');
	});

	it('strips traversal segments embedded in fileName', async () => {
		const [file] = await extractFilesFromComputeResponse([
			fd({ fileName: '../../etc/passwd', fileType: '' })
		]);
		expect(file.path).toBe('etc/passwd');
	});

	it('makes an absolute subFolder relative', async () => {
		const [file] = await extractFilesFromComputeResponse([
			fd({ subFolder: '/etc', fileName: 'a', fileType: '.txt' })
		]);
		expect(file.path).toBe('etc/a.txt');
	});

	it('normalizes backslash paths and drops drive letters', async () => {
		const [file] = await extractFilesFromComputeResponse([
			fd({ subFolder: 'C:\\..\\Windows', fileName: 'a', fileType: '.txt' })
		]);
		expect(file.path).toBe('Windows/a.txt');
	});

	it('keeps legitimate nested subFolders intact', async () => {
		const [file] = await extractFilesFromComputeResponse([
			fd({ subFolder: 'nested/dir', fileName: 'a', fileType: '.json' })
		]);
		expect(file.path).toBe('nested/dir/a.json');
	});

	it('skips an item whose name sanitizes to nothing', async () => {
		const files = await extractFilesFromComputeResponse([
			fd({ fileName: '..', fileType: '' }),
			fd({ data: 'kept' })
		]);
		expect(files).toHaveLength(1);
		expect(files[0].content).toBe('kept');
	});

	it('sanitizes external file names too', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: async () => new Uint8Array([1]).buffer
			})
		);
		const files = await extractFilesFromComputeResponse([], {
			fileName: '../escape.bin',
			filePath: 'https://example.com/escape.bin'
		});
		expect(files).toHaveLength(1);
		expect(files[0].path).toBe('escape.bin');
	});
});

describe('extractFilesFromComputeResponse — fetch half', () => {
	const ref: FileBaseInfo = { fileName: 'extra.bin', filePath: 'https://example.com/extra.bin' };

	it('includes successfully-fetched external files', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: async () => new Uint8Array([9, 9]).buffer
			})
		);

		const files = await extractFilesFromComputeResponse([fd({ data: 'a' })], ref);
		expect(files).toHaveLength(2);
		const fetched = files.find((f) => f.fileName === 'extra.bin');
		expect(fetched).toBeDefined();
		expect(Array.from(fetched!.content as Uint8Array)).toEqual([9, 9]);
	});

	// Issue 111: remote files may specify a subFolder instead of always landing at zip root.
	it('honors an optional subFolder on external files (sanitized)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: async () => new Uint8Array([7]).buffer
			})
		);

		const files = await extractFilesFromComputeResponse([], {
			fileName: 'extra.bin',
			filePath: 'https://example.com/extra.bin',
			subFolder: '../extras/docs'
		});
		expect(files).toHaveLength(1);
		expect(files[0].path).toBe('extras/docs/extra.bin');
	});

	// The swallow is deliberate: a failed remote fetch must drop that file and let
	// the rest proceed, never abort the batch. Pinned so it stays intentional.
	it('drops a file on a non-OK response, keeping the others', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

		const files = await extractFilesFromComputeResponse([fd({ data: 'kept' })], ref);
		expect(files).toHaveLength(1);
		expect(files[0].content).toBe('kept');
	});

	it('drops a file on a network error, keeping the others', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

		const files = await extractFilesFromComputeResponse([fd({ data: 'kept' })], ref);
		expect(files).toHaveLength(1);
		expect(files[0].content).toBe('kept');
	});
});

/**
 * Issue 95: wire payloads arrive PascalCase from mcneel-branch servers and with
 * string-typed booleans from others; neither shape may silently drop files.
 */
describe('extractFilesFromComputeResponse — wire-shape leniency (issue 95)', () => {
	it('decodes a fully PascalCase payload (mcneel-branch server)', async () => {
		const item = {
			FileName: 'model',
			Data: 'hello pascal',
			FileType: '.txt',
			IsBase64Encoded: false,
			SubFolder: 'nested'
		} as unknown as FileData;

		const [file] = await extractFilesFromComputeResponse([item]);
		expect(file).toMatchObject({
			fileName: 'model.txt',
			content: 'hello pascal',
			path: 'nested/model.txt'
		});
	});

	it('treats a string "true" isBase64Encoded flag as base64', async () => {
		const bytes = new Uint8Array([10, 20, 30]);
		const [file] = await extractFilesFromComputeResponse([
			fd({
				data: base64ByteArray(bytes),
				fileType: '.bin',
				isBase64Encoded: 'true' as unknown as boolean
			})
		]);
		expect(file.content).toBeInstanceOf(Uint8Array);
		expect(Array.from(file.content as Uint8Array)).toEqual([10, 20, 30]);
	});

	it('treats a string "false" flag as plain text', async () => {
		const [file] = await extractFilesFromComputeResponse([
			fd({ data: 'plain', isBase64Encoded: 'false' as unknown as boolean })
		]);
		expect(file.content).toBe('plain');
	});

	it('keeps a file whose flag is missing but whose data is present (plain-text fallback)', async () => {
		const [file] = await extractFilesFromComputeResponse([
			fd({ data: 'still here', isBase64Encoded: undefined as unknown as boolean })
		]);
		expect(file.content).toBe('still here');
	});

	it('skips only when data is genuinely absent', async () => {
		const files = await extractFilesFromComputeResponse([
			fd({ data: undefined as unknown as string, isBase64Encoded: true }),
			fd({ data: 'kept' })
		]);
		expect(files).toHaveLength(1);
		expect(files[0].content).toBe('kept');
	});
});

describe('extractFilesFromComputeResponse — decode-failure skip branch', () => {
	it('skips an undecodable base64 item and keeps the rest of the batch', async () => {
		const files = await extractFilesFromComputeResponse([
			fd({ data: '!!!not-base64!!!', isBase64Encoded: true, fileName: 'broken', fileType: '.bin' }),
			fd({ data: 'kept' })
		]);
		expect(files).toHaveLength(1);
		expect(files[0].content).toBe('kept');
	});
});

/**
 * Issue 111: duplicate archive paths must be renamed on the extract path too, not
 * just inside the zip — consumers keying by `path` must never lose files.
 */
describe('extractFilesFromComputeResponse — duplicate-path rename', () => {
	it('renames colliding paths with a numeric suffix before the extension', async () => {
		const files = await extractFilesFromComputeResponse([
			fd({ data: 'first' }),
			fd({ data: 'second' }),
			fd({ data: 'third' })
		]);
		expect(files.map((f) => f.path)).toEqual(['model.txt', 'model-2.txt', 'model-3.txt']);
		expect(files.map((f) => f.fileName)).toEqual(['model.txt', 'model-2.txt', 'model-3.txt']);
		expect(files.map((f) => f.content)).toEqual(['first', 'second', 'third']);
	});

	it('renames collisions between inline and fetched files', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: async () => new Uint8Array([1]).buffer
			})
		);

		const files = await extractFilesFromComputeResponse([fd({ fileName: 'model' })], {
			fileName: 'model.txt',
			filePath: 'https://example.com/model.txt'
		});
		expect(files.map((f) => f.path).sort()).toEqual(['model-2.txt', 'model.txt']);
	});

	it('leaves same-name files in different subFolders untouched', async () => {
		const files = await extractFilesFromComputeResponse([
			fd({ subFolder: 'a' }),
			fd({ subFolder: 'b' })
		]);
		expect(files.map((f) => f.path)).toEqual(['a/model.txt', 'b/model.txt']);
	});
});
