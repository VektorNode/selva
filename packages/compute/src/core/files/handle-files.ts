import { ComputeError, ErrorCodes } from '@/core/errors';
import { getLogger } from '@/core/utils/logger';
import { decodeBase64ToBinary } from '@/core/utils/encoding';
import { readField } from '@/core/utils/read-field';

import { FileBaseInfo, FileData, ProcessedFile } from './types';
import { groupFilesByRoot, pathBelowRoot, subFolderSegments, toArchiveName } from './sub-folder';

/**
 * Decode the files in a compute response, plus any external `additionalFiles`, without
 * downloading them. Never throws: an unnamed or undecodable item and a failed external fetch are
 * logged and dropped, the rest still resolve. Colliding archive paths are renamed
 * (`model.txt` → `model-2.txt`), so a consumer keying by `path` loses nothing.
 */
export const extractFilesFromComputeResponse = async (
	downloadableFiles: FileData[],
	additionalFiles: FileBaseInfo[] | FileBaseInfo | null = null
): Promise<ProcessedFile[]> => {
	const processedFiles = decodeResponseFiles(downloadableFiles);

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

/** Downloads files from a compute response as a ZIP archive. */
export const downloadFileData = async (
	downloadableFiles: FileData[],
	fileFoldername: string,
	additionalFiles: FileBaseInfo[] | FileBaseInfo | null = null
): Promise<void> => {
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
		const processedFiles = await extractFilesFromComputeResponse(
			downloadableFiles,
			additionalFiles
		);
		await createAndDownloadZip(processedFiles, fileFoldername);
	} catch (err) {
		if (err instanceof ComputeError) {
			throw err;
		}
		throw new ComputeError(
			'Failed to download files from compute response',
			ErrorCodes.INVALID_STATE,
			{
				context: { originalError: err instanceof Error ? err.message : String(err) },
				originalError: err
			}
		);
	}
};

/**
 * Download one archive per `Sub Folder` root (see {@link groupFilesByRoot}). Files with no root go
 * into `fallbackName`, so a definition that never sets `Sub Folder` downloads as one archive.
 *
 * Archives are saved one at a time: browsers discard concurrent downloads issued in the same tick.
 * More than one save per gesture may prompt the user for permission.
 *
 * @param downloadableFiles - `FileData` items from the compute response.
 * @param fallbackName - Archive name for files with no `Sub Folder` root.
 * @param additionalFiles - Extra files to package; they carry no root and join the fallback archive.
 */
export const downloadFileDataByRoot = async (
	downloadableFiles: FileData[],
	fallbackName: string,
	additionalFiles: FileBaseInfo[] | FileBaseInfo | null = null
): Promise<void> => {
	const groups = groupFilesByRoot(downloadableFiles);

	// Extras alone still deserve an archive; without this they'd be dropped for having no root.
	if (groups.length === 0) {
		await downloadFileData([], fallbackName, additionalFiles);
		return;
	}

	// Extras belong to the definition rather than to any one root, so they ride with the rootless
	// archive — or with the first one when every file is rooted, rather than being dropped.
	const extrasRoot = (groups.find((group) => group.root === '') ?? groups[0]).root;

	for (const { root, files } of groups) {
		await downloadFileData(
			root === '' ? files : files.map((file) => ({ ...file, subFolder: pathBelowRoot(file) })),
			root === '' ? fallbackName : toArchiveName(root),
			root === extrasRoot ? additionalFiles : null
		);
	}
};

/**
 * Zip-slip defense for a server-controlled path: drop `.`, `..` and drive-letter segments so no
 * entry escapes the extraction directory. `''` when nothing safe remains.
 */
const sanitizeArchivePath = (raw: string): string =>
	subFolderSegments(raw)
		.filter((segment) => segment !== '.' && segment !== '..' && !/^[a-zA-Z]:$/.test(segment))
		.join('/');

/** The `isBase64Encoded` wire flag. Some server branches send booleans as strings (`"True"`). */
export const isBase64Flag = (flag: unknown): boolean =>
	flag === true || (typeof flag === 'string' && flag.trim().toLowerCase() === 'true');

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

		const data = readField<unknown>(item, 'data');
		if (typeof data !== 'string' || data === '') {
			getLogger().warn(`Skipping file "${filePath}": item carries no usable data.`);
			return;
		}

		const metadata = readField<Record<string, string>>(item, 'metadata');

		if (isBase64Flag(readField<unknown>(item, 'isBase64Encoded'))) {
			try {
				processedFiles.push({
					fileName,
					content: decodeBase64ToBinary(data),
					path: filePath,
					subFolder,
					...(metadata ? { metadata } : {})
				});
			} catch (err) {
				getLogger().warn(`Skipping file "${filePath}": base64 decode failed.`, err);
			}
		} else {
			processedFiles.push({
				fileName,
				content: data,
				path: filePath,
				subFolder,
				...(metadata ? { metadata } : {})
			});
		}
	});

	return processedFiles;
};

/** One dead URL must degrade the batch, not stall it forever. */
const REMOTE_FILE_TIMEOUT_MS = 30_000;

const fetchRemoteFiles = async (refs: FileBaseInfo[]): Promise<ProcessedFile[]> => {
	const fetched = await Promise.all(
		refs.map(async (file) => {
			try {
				const response = await fetch(file.filePath, {
					signal: AbortSignal.timeout(REMOTE_FILE_TIMEOUT_MS)
				});
				if (!response.ok) {
					getLogger().warn(`Failed to fetch additional file from URL: ${file.filePath}`);
					return null;
				}
				const arrayBuffer = await response.arrayBuffer();
				const safeName = sanitizeArchivePath(file.fileName);
				if (safeName === '') {
					getLogger().warn(`Skipping fetched file with unusable name: ${file.fileName}`);
					return null;
				}
				const subFolder = file.subFolder ? sanitizeArchivePath(file.subFolder) : '';
				return {
					fileName: safeName,
					content: new Uint8Array(arrayBuffer),
					path: subFolder !== '' ? `${subFolder}/${safeName}` : safeName,
					// No `metadata`: an external URL carries no GH authoring context.
					subFolder
				} as ProcessedFile;
			} catch (error) {
				getLogger().error(`Error fetching additional file from URL: ${file.filePath}`, error);
				return null;
			}
		})
	);

	return fetched.filter((f): f is ProcessedFile => f !== null);
};

async function createAndDownloadZip(files: ProcessedFile[], zipName: string): Promise<void> {
	const { zip, strToU8 } = await import('fflate');

	// Paths are already unique: extractFilesFromComputeResponse renames collisions. fflate
	// flattens entries into a plain object, where a root entry named `__proto__` is lost.
	const taken = new Set(files.map((file) => file.path));
	const zipData: Record<string, Uint8Array> = {};
	for (const file of files) {
		const path = file.path === '__proto__' ? uniqueArchivePath(file.path, taken) : file.path;
		taken.add(path);
		zipData[path] = typeof file.content === 'string' ? strToU8(file.content) : file.content;
	}

	// Async `zip` deflates on a worker thread; `zipSync` would block the UI on large exports.
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

function saveFile(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	// Firefox requires the anchor to be in the DOM for the click to download.
	document.body.appendChild(a);
	a.click();
	a.remove();
	// Revoking synchronously can abort the download: the browser pins the blob only once it starts.
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
