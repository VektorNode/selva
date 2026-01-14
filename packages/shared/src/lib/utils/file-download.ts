/**
 * Wrapper utilities for file downloads from Grasshopper outputs
 * Uses the core package implementation for file handling
 */

import { downloadFileData, type FileData } from '@selva/compute/files';

/**
 * Download file(s) from Grasshopper outputs
 * Single files are downloaded directly, multiple files are packaged as ZIP
 */
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
			// Single file - download directly
			await downloadSingleFile(filesArray[0]);
		} else {
			// Multiple files - use core's ZIP functionality
			await downloadFileData(filesArray, fileName);
		}
	} catch (error) {
		console.error('[FileDownload] Error downloading files:', error);
		throw error;
	}
}

/**
 * Download a single file directly
 */
async function downloadSingleFile(fileData: FileData): Promise<void> {
	try {
		await downloadFileData([fileData], fileData.FileName.replace(/\.[^.]*$/, ''));
	} catch (error) {
		console.error('[FileDownload] Error downloading single file:', error);
		throw error;
	}
}

/**
 * Check if data is FileData
 */
export function isFileData(data: unknown): data is FileData {
	return (
		typeof data === 'object' &&
		data !== null &&
		'FileName' in data &&
		'Data' in data &&
		'IsBase64Encoded' in data
	);
}

/**
 * Check if data is FileData array
 */
export function isFileDataArray(data: unknown): data is FileData[] {
	return Array.isArray(data) && data.length > 0 && isFileData(data[0]);
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 Bytes';

	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get approximate file size from base64 string
 */
export function getBase64FileSize(base64: string): number {
	// Base64 encoded string is approximately 33% larger than original
	return Math.ceil((base64.length * 3) / 4);
}
