import {
	BINARY_SOLVE_FLAG_GZIP_JSON,
	BINARY_SOLVE_MEDIA_TYPE,
	isBlobRef,
	isDisplayItemType,
	readFrame
} from '../shared/binary-response.js';

/** Null where the browser can't gunzip the JSON section, so the client must not ask for binary. */
export const BINARY_ACCEPT_HEADER =
	typeof DecompressionStream === 'undefined'
		? null
		: `${BINARY_SOLVE_MEDIA_TYPE}, application/json;q=0.9`;

export function isBinarySolveResponse(res: Response): boolean {
	return (res.headers.get('Content-Type') ?? '').startsWith(BINARY_SOLVE_MEDIA_TYPE);
}

/**
 * The response JSON with each display item's `data` parsed into its batch object, its
 * `compressedData` the blob's bytes. The blobs are views over `bytes`, so they keep it alive.
 */
export async function decodeBinarySolveResponse(bytes: Uint8Array): Promise<unknown> {
	const { flags, json, blobs } = readFrame(bytes);
	const jsonBytes = flags & BINARY_SOLVE_FLAG_GZIP_JSON ? await gunzip(json) : json;
	const parsed: unknown = JSON.parse(new TextDecoder().decode(jsonBytes));

	const values = (parsed as { values?: unknown } | null)?.values;
	if (!Array.isArray(values)) return parsed;
	for (const value of values as Record<string, unknown>[]) {
		for (const tree of [value?.InnerTree, value?.innerTree]) {
			if (!tree || typeof tree !== 'object') continue;
			for (const branch of Object.values(tree)) {
				if (Array.isArray(branch)) for (const item of branch) attachBlob(item, blobs);
			}
		}
	}
	return parsed;
}

function attachBlob(item: unknown, blobs: Uint8Array[]): void {
	const display = item as { type?: unknown; data?: unknown } | null;
	if (typeof display?.type !== 'string' || typeof display.data !== 'string') return;
	if (!isDisplayItemType(display.type)) return;
	const batch = JSON.parse(display.data) as { compressedData?: unknown };
	if (isBlobRef(batch.compressedData)) {
		const blob = blobs[batch.compressedData.$blob];
		if (!blob) throw new Error('Malformed binary solve response: a batch names a missing blob');
		batch.compressedData = blob;
	}
	display.data = batch;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}
