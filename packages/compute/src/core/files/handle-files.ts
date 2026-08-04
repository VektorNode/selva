import { ComputeError, ErrorCodes } from '@/core/errors';
import { getLogger } from '@/core/utils/logger';
import { decodeBase64ToBinary } from '@/core/utils/encoding';
import { readField } from '@/core/utils/read-field';

import { FileBaseInfo, FileData, ProcessedFile } from './types';

/** Extracts and processes files from compute response data without downloading them. */
export const extractFilesFromComputeResponse = async (
	downloadableFiles: FileData[],
	additionalFiles: FileBaseInfo[] | FileBaseInfo | null = null
): Promise<ProcessedFile[]> => {
	try {
		return await processFiles(downloadableFiles, additionalFiles);
	} catch (err) {
		throw new ComputeError(
			'Failed to extract files from compute response',
			ErrorCodes.INVALID_STATE,
			{
				context: { originalError: err instanceof Error ? err.message : String(err) },
				originalError: err instanceof Error ? err : undefined
			}
		);
	}
};

/** Downloads files from a compute response as a ZIP archive. */
export const downloadFileData = async (
	downloadableFiles: FileData[],
	fileFoldername: string,
	additionalFiles: FileBaseInfo[] | FileBaseInfo | null = null
): Promise<void> => {
	// Check if we're in a browser environment
	if (typeof document === 'undefined' || typeof Blob === 'undefined') {
		throw new ComputeError(
			'File download functionality is only available in browser environments. This function requires the DOM API (document, Blob).',
			ErrorCodes.BROWSER_ONLY,
			{
				context: {
					environment: typeof window !== 'undefined' ? 'browser (SSR)' : 'Node.js',
					documentAvailable: typeof document !== 'undefined',
					blobAvailable: typeof Blob !== 'undefined'
				}
			}
		);
	}

	try {
		const processedFiles = await processFiles(downloadableFiles, additionalFiles);
		await createAndDownloadZip(processedFiles, fileFoldername);
	} catch (err) {
		// Re-throw if it's already a ComputeError
		if (err instanceof ComputeError) {
			throw err;
		}
		throw new ComputeError(
			'Failed to download files from compute response',
			ErrorCodes.INVALID_STATE,
			{
				context: { originalError: err instanceof Error ? err.message : String(err) },
				originalError: err instanceof Error ? err : undefined
			}
		);
	}
};

/**
 * Reduce a server-controlled path field to safe relative segments for use inside the zip
 * (zip-slip defense): backslashes normalize to `/`, and empty, `.`, `..`, and drive-letter
 * segments are dropped so no entry can escape the extraction directory via traversal or an
 * absolute path. Returns '' when nothing safe remains.
 */
const sanitizeArchivePath = (raw: string): string =>
	raw
		.replace(/\\/g, '/')
		.split('/')
		.map((segment) => segment.trim())
		.filter(
			(segment) =>
				segment !== '' && segment !== '.' && segment !== '..' && !/^[a-zA-Z]:$/.test(segment)
		)
		.join('/');

/**
 * Lenient read of the `isBase64Encoded` wire flag: some server branches serialize
 * booleans as strings (`"true"`/`"True"`), which must still count as base64 rather
 * than silently dropping the file (issue 95).
 */
const isBase64Flag = (flag: unknown): boolean =>
	flag === true || (typeof flag === 'string' && flag.trim().toLowerCase() === 'true');

/**
 * Decode the inline files carried in a compute response into `ProcessedFile`s.
 *
 * Pure and synchronous: base64 items are decoded to binary, plain-text items are
 * passed through, and the archive path is derived from `subFolder` + name.
 * Degrades per-file like {@link fetchRemoteFiles}: an item with no usable `data`
 * or with undecodable base64 is logged and skipped, never aborting the batch.
 * This is the half of file handling that both public entry points share; it
 * never touches the network and never throws.
 *
 * Wire fields are read case-insensitively via {@link readField}: mcneel-branch
 * servers serialize PascalCase (`FileName`, `Data`, `IsBase64Encoded`, …) while
 * the VektorNode fork uses camelCase — both must decode (issue 95).
 *
 * @param dataItems - `FileData` items from the compute response.
 * @returns The decoded files.
 */
const decodeResponseFiles = (dataItems: FileData[]): ProcessedFile[] => {
	const processedFiles: ProcessedFile[] = [];

	dataItems.forEach((item) => {
		const rawName = readField<string>(item, 'fileName') ?? '';
		const rawType = readField<string>(item, 'fileType') ?? '';
		const fileName = sanitizeArchivePath(`${rawName}${rawType}`);
		if (fileName === '') {
			getLogger().warn(
				`Skipping file with unusable name "${rawName}${rawType}": no safe archive path remains after sanitization.`
			);
			return;
		}
		const rawSubFolder = readField<string>(item, 'subFolder');
		const subFolder = rawSubFolder ? sanitizeArchivePath(rawSubFolder) : '';
		const filePath = subFolder !== '' ? `${subFolder}/${fileName}` : fileName;

		// Only a genuinely absent/empty body is unusable — the flag's exact type
		// must never decide that (issue 95).
		const data = readField<unknown>(item, 'data');
		if (typeof data !== 'string' || data === '') {
			getLogger().warn(`Skipping file "${filePath}": item carries no usable data.`);
			return;
		}

		if (isBase64Flag(readField<unknown>(item, 'isBase64Encoded'))) {
			// `decodeBase64ToBinary` already returns a correctly-bounded view;
			// re-wrapping `.buffer` would discard its byteOffset/byteLength and
			// expose the whole (possibly pooled) backing buffer as corrupt content.
			try {
				processedFiles.push({
					fileName,
					content: decodeBase64ToBinary(data),
					path: filePath
				});
			} catch (err) {
				getLogger().warn(`Skipping file "${filePath}": base64 decode failed.`, err);
			}
		} else {
			processedFiles.push({
				fileName,
				content: data,
				path: filePath
			});
		}
	});

	return processedFiles;
};

/** Abort a hung external-file fetch — one dead URL must degrade the batch, not stall it forever. */
const REMOTE_FILE_TIMEOUT_MS = 30_000;

/**
 * Fetch externally-referenced files over HTTP into `ProcessedFile`s.
 *
 * Async and fallible by nature. A failed fetch (network error, non-OK status,
 * or timeout after {@link REMOTE_FILE_TIMEOUT_MS}) is logged and that file is
 * dropped — the rest still resolve — so one dead URL degrades the result rather
 * than aborting the whole batch. This swallow is deliberate and pinned by
 * tests; callers receive only the files that succeeded.
 *
 * @param refs - External file references to fetch.
 * @returns The successfully-fetched files (failures omitted).
 */
const fetchRemoteFiles = async (refs: FileBaseInfo[]): Promise<ProcessedFile[]> => {
	const fetched = await Promise.all(
		refs.map(async (file) => {
			try {
				const signal =
					typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
						? AbortSignal.timeout(REMOTE_FILE_TIMEOUT_MS)
						: undefined;
				const response = await fetch(file.filePath, { signal });
				if (!response.ok) {
					getLogger().warn(`Failed to fetch additional file from URL: ${file.filePath}`);
					return null;
				}
				// One step, no intermediate Blob allocation (issue 111).
				const arrayBuffer = await response.arrayBuffer();
				// Same zip-slip defense as decodeResponseFiles — the name lands in the archive.
				const safeName = sanitizeArchivePath(file.fileName);
				if (safeName === '') {
					getLogger().warn(`Skipping fetched file with unusable name: ${file.fileName}`);
					return null;
				}
				const subFolder = file.subFolder ? sanitizeArchivePath(file.subFolder) : '';
				return {
					fileName: safeName,
					content: new Uint8Array(arrayBuffer),
					path: subFolder !== '' ? `${subFolder}/${safeName}` : safeName
				} as ProcessedFile;
			} catch (error) {
				getLogger().error(`Error fetching additional file from URL: ${file.filePath}`, error);
				return null;
			}
		})
	);

	return fetched.filter((f): f is ProcessedFile => f !== null);
};

/**
 * Compose the decoded response files with any fetched external files.
 *
 * Archive paths are de-duplicated here — on the path both public entry points
 * share — so `extractFilesFromComputeResponse` consumers keying by `path` never
 * lose files silently, matching the zip path's rename behavior (issue 111).
 *
 * @param dataItems - `FileData` items from the compute response.
 * @param additionalFiles - Optional external file references to fetch and include.
 * @returns A Promise resolving to the combined `ProcessedFile` list.
 */
const processFiles = async (
	dataItems: FileData[],
	additionalFiles: FileBaseInfo[] | FileBaseInfo | null
): Promise<ProcessedFile[]> => {
	const processedFiles = decodeResponseFiles(dataItems);

	if (additionalFiles) {
		const filesArray = Array.isArray(additionalFiles) ? additionalFiles : [additionalFiles];
		processedFiles.push(...(await fetchRemoteFiles(filesArray)));
	}

	const taken = new Set<string>();
	return processedFiles.map((file) => {
		const path = uniqueArchivePath(file.path, taken);
		taken.add(path);
		if (path === file.path) return file;
		getLogger().warn(`Duplicate archive path "${file.path}" — storing as "${path}".`);
		return { ...file, path, fileName: path.slice(path.lastIndexOf('/') + 1) };
	});
};

/** Creates a ZIP archive from processed files and triggers a browser download. */
async function createAndDownloadZip(files: ProcessedFile[], zipName: string): Promise<void> {
	const { zip, strToU8 } = await import('fflate');

	// Convert files to fflate format. Zip entries are keyed by path, so two
	// files with the same path would silently overwrite each other — rename
	// collisions ("model.txt" → "model-2.txt") instead of losing data.
	// (processFiles already de-duplicates; this is a cheap second line of
	// defense in case callers construct ProcessedFiles themselves.)
	const zipData: Record<string, Uint8Array> = {};
	const taken = new Set<string>();
	files.forEach((file) => {
		const path = uniqueArchivePath(file.path, taken);
		taken.add(path);
		if (path !== file.path) {
			getLogger().warn(`Duplicate archive path "${file.path}" — storing as "${path}".`);
		}
		zipData[path] = typeof file.content === 'string' ? strToU8(file.content) : file.content;
	});

	// Async `zip` deflates on a worker thread instead of blocking the main thread
	// like `zipSync` — keeps the UI responsive for large geometry exports.
	const zipped = await new Promise<Uint8Array>((resolve, reject) => {
		zip(zipData, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
	});

	const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
	saveFile(blob, `${zipName}.zip`);
}

/**
 * First archive path not already taken in `taken`, disambiguating with a
 * numeric suffix before the extension: `dir/model.txt` → `dir/model-2.txt`.
 */
function uniqueArchivePath(path: string, taken: ReadonlySet<string>): string {
	if (!taken.has(path)) return path;
	const slash = path.lastIndexOf('/');
	const dot = path.lastIndexOf('.');
	const stemEnd = dot > slash ? dot : path.length;
	const stem = path.slice(0, stemEnd);
	const ext = path.slice(stemEnd);
	for (let i = 2; ; i++) {
		const candidate = `${stem}-${i}${ext}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** Saves a Blob object as a file in the user's browser. */
function saveFile(blob: Blob, filename: string) {
	if (typeof document === 'undefined') {
		throw new ComputeError(
			'saveFile requires a browser environment with DOM API access.',
			ErrorCodes.BROWSER_ONLY,
			{
				context: { function: 'saveFile', requiredAPI: 'document' }
			}
		);
	}

	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	// Firefox requires the anchor to be in the DOM for the click to download.
	document.body.appendChild(a);
	a.click();
	a.remove();
	// Revoking synchronously can abort the download in some browsers — the
	// browser only pins the blob once the download has actually started.
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
