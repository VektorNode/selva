/**
 * Tests for the GrasshopperResponseProcessor class — the public wrapper consumers
 * use to read solve results. The underlying free functions (`getValues`,
 * `getValue`, `extractFileData`) are tested in response-processors.test.ts; here we
 * pin the CLASS behavior: that it threads the response through to them, exposes it for
 * renderer-side mesh parsing, and forwards extracted files to the downloader.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import GrasshopperResponseProcessor from '../grasshopper-response-processor';
import type { GrasshopperComputeResponse, DataItem } from '../../types';

// Mock the file-download seam so getAndDownloadFiles doesn't need a DOM.
const downloadFileData = vi.fn();
vi.mock('@/core/files/handle-files', () => ({
	downloadFileData: (...args: unknown[]) => downloadFileData(...args)
}));

function item(type: string, data: string, id = ''): DataItem {
	return { type, data, id };
}
function param(paramName: string, items: DataItem[], branch = '{0}') {
	return { ParamName: paramName, InnerTree: { [branch]: items } };
}
function response(...params: ReturnType<typeof param>[]): GrasshopperComputeResponse {
	return { values: params } as unknown as GrasshopperComputeResponse;
}

const fileItem = (name: string) =>
	item(
		'Selva.FileData',
		JSON.stringify({
			fileName: name,
			fileType: 'bin',
			data: 'AAAA',
			isBase64Encoded: true,
			subFolder: ''
		})
	);

beforeEach(() => {
	downloadFileData.mockClear();
});

describe('GrasshopperResponseProcessor — value access', () => {
	it('reads all values keyed by name through the bound response', () => {
		const proc = new GrasshopperResponseProcessor(
			response(param('radius', [item('System.Double', '2.5')]))
		);
		expect(proc.getValues().values.radius).toBe(2.5);
	});

	it('reads a single value by name', () => {
		const proc = new GrasshopperResponseProcessor(
			response(param('label', [item('System.String', '"hello"')]))
		);
		expect(proc.getValue({ byName: 'label' })).toBe('hello');
	});

	it('returns undefined for a parameter that is not present', () => {
		const proc = new GrasshopperResponseProcessor(
			response(param('a', [item('System.Int32', '1')]))
		);
		expect(proc.getValue({ byName: 'missing' })).toBeUndefined();
	});
});

describe('GrasshopperResponseProcessor — file download', () => {
	it('extracts file entries from the response and forwards them to downloadFileData', async () => {
		const proc = new GrasshopperResponseProcessor(response(param('files', [fileItem('out.bin')])));

		await proc.getAndDownloadFiles('my-folder');

		expect(downloadFileData).toHaveBeenCalledTimes(1);
		const [files, folder, additional] = downloadFileData.mock.calls[0];
		expect(folder).toBe('my-folder');
		expect(additional).toBeUndefined();
		expect(files).toHaveLength(1);
		expect(files[0]).toMatchObject({ fileName: 'out.bin' });
	});

	it('passes additional files through to the downloader', async () => {
		const proc = new GrasshopperResponseProcessor(response(param('files', [])));
		const extra = { name: 'notes.txt', data: 'hi' } as never;

		await proc.getAndDownloadFiles('proj', extra);

		const [files, , additional] = downloadFileData.mock.calls[0];
		expect(files).toHaveLength(0); // no file items in the response
		expect(additional).toBe(extra);
	});
});

// `extractMeshesFromResponse()` used to live here. Mesh decoding moved to `@selvajs/visualization`
// so this package stays pure solve/data with no `three` dependency; callers now pass the raw
// response to `getThreeMeshesFromComputeResponse` themselves. What this class still owes them is
// access to that response — pinned below.
describe('GrasshopperResponseProcessor — renderer hand-off', () => {
	it('exposes the bound response so a renderer-side parser can consume it', () => {
		const res = response(param('m', []));
		const proc = new GrasshopperResponseProcessor(res);

		expect(proc.response).toBe(res);
	});

	it('exposes the debug flag it was constructed with', () => {
		expect(new GrasshopperResponseProcessor(response(param('m', []))).debug).toBe(false);
		expect(new GrasshopperResponseProcessor(response(param('m', [])), true).debug).toBe(true);
	});
});
