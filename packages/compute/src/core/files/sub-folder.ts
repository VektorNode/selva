import type { FileData } from './types';

/**
 * The `Sub Folder` convention, as authored on Selva's Grasshopper file components.
 *
 * `::` nests, matching Rhino's layer separator (`ROOT::Panels`), and `/` and `\` are accepted
 * because people type them out of habit. The plugin normalizes to `/` before sending, so these
 * helpers also cover payloads from an older plugin that still emit `::`.
 *
 * The first segment is the **root**, which names the archive rather than becoming a folder inside
 * it: `ROOT::Panels` downloads as `ROOT.zip` containing `Panels/…`. Files sharing a root travel
 * together; distinct roots produce separate archives.
 */

/**
 * Split a `Sub Folder` value into folder segments; `/`, `\` and `::` all separate.
 *
 * Exported because anything rendering a folder tree has to agree with the archive on where the
 * boundaries are: splitting on `/` alone leaves `Main::Panels` as one literal segment and shows
 * a folder named after the separator.
 */
export const subFolderSegments = (subFolder: string | undefined): string[] =>
	(subFolder ?? '')
		.replace(/::/g, '/')
		.replace(/\\/g, '/')
		.split('/')
		.map((segment) => segment.trim())
		.filter((segment) => segment !== '');

/** First `Sub Folder` segment, or `''` when the file sits at the top level. */
export const rootOf = (file: Pick<FileData, 'subFolder'>): string =>
	subFolderSegments(file.subFolder)[0] ?? '';

/**
 * Everything below the root, as a `/`-joined path. The root names the archive, so repeating it
 * inside would nest it twice.
 */
export const pathBelowRoot = (file: Pick<FileData, 'subFolder'>): string =>
	subFolderSegments(file.subFolder).slice(1).join('/');

/**
 * Group files by their `Sub Folder` root, preserving encounter order.
 *
 * Rootless files group under `''`: a caller naming archives supplies its own fallback for that
 * bucket. Useful beyond downloading: a consumer writing to disk gets the same grouping without
 * touching the DOM.
 */
export const groupFilesByRoot = <T extends Pick<FileData, 'subFolder'>>(
	files: readonly T[]
): Array<{ root: string; files: T[] }> => {
	const groups = new Map<string, T[]>();

	for (const file of files) {
		const root = rootOf(file);
		const bucket = groups.get(root);
		if (bucket) bucket.push(file);
		else groups.set(root, [file]);
	}

	return Array.from(groups, ([root, grouped]) => ({ root, files: grouped }));
};

/**
 * Make a root usable as a download filename: path separators and the characters Windows forbids
 * would otherwise reach the download attribute verbatim and produce a broken or misdirected save.
 */
export const toArchiveName = (root: string): string => {
	const safe = root
		.replace(/[/\\:*?"<>|]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '');

	return safe === '' ? 'files' : safe;
};
