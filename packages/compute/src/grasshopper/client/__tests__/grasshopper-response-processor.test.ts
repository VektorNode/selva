/**
 * The value-reading functions are tested in response-processors.test.ts; this pins what the class
 * adds, forwarding extracted files to the downloader.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import GrasshopperResponseProcessor from '../grasshopper-response-processor';
import type { GrasshopperComputeResponse, DataItem } from '../../types';

// Mock the file-download seam so getAndDownloadFiles doesn't need a DOM.
const downloadFileData = vi.fn();
vi.mock('@/core/files/handle-files', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/core/files/handle-files')>()),
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
