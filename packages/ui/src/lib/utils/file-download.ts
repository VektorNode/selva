import { downloadFileData, type FileData } from '@selvajs/compute';
import { SvelteMap } from 'svelte/reactivity';
import { APP_DEFAULTS } from '../constants';

export const MIME_BY_EXT: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.json': 'application/json',
	'.txt': 'text/plain',
	'.csv': 'text/csv',
	'.xml': 'application/xml',
	'.pdf': 'application/pdf',
	'.3dm': 'model/vnd.3dm',
	'.obj': 'model/obj',
	'.stl': 'model/stl'
};

function saveSingleFile(file: FileData): void {
	const ext = (file.fileType ?? '').toLowerCase();
	const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';

	let blob: Blob;
	if (file.isBase64Encoded) {
		const binary = atob(file.data);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		blob = new Blob([bytes], { type: mime });
	} else {
		blob = new Blob([file.data], { type: mime });
	}

	const fullName = `${file.fileName}${file.fileType ?? ''}`;
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = fullName;
	a.click();
	URL.revokeObjectURL(a.href);
}

export async function downloadFiles(
	fileData: FileData | FileData[],
	fileName: string = 'grasshopper-output'
): Promise<void> {
	try {
		const filesArray = Array.isArray(fileData) ? fileData : [fileData];

		if (filesArray.length === 0) {
			console.warn('[FileDownload] No files to download');
			return;
		}

		if (filesArray.length === 1) {
			saveSingleFile(filesArray[0]);
			return;
		}

		await downloadFileData(filesArray, fileName);
	} catch (error) {
		console.error('[FileDownload] Error downloading files:', error);
		throw error;
	}
}

export function isFileData(data: unknown): data is FileData {
	return (
		typeof data === 'object' &&
		data !== null &&
		'fileName' in data &&
		'data' in data &&
		'isBase64Encoded' in data
	);
}

export function groupMessages(messages: string[]): Array<{ message: string; count: number }> {
	const grouped = new SvelteMap<string, number>();
	for (const msg of messages) {
		const baseMsg = msg.replace(/\([a-f0-9-]{36}\)$/i, '(...)').trim();
		grouped.set(baseMsg, (grouped.get(baseMsg) ?? 0) + 1);
	}
	return Array.from(grouped.entries())
		.map(([message, count]) => ({ message, count }))
		.sort((a, b) => b.count - a.count);
}

export function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 Bytes';

	const k = APP_DEFAULTS.FILE_SIZE.BYTES_PER_KB;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export function getBase64FileSize(base64: string): number {
	return Math.ceil((base64.length * 3) / 4);
}
