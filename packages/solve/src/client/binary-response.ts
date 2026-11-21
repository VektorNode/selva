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

export interface DecodedBinaryResponse {
	response: unknown;
	/**
	 * Drops every batch's bytes once the meshes are built. They are views over the whole frame, so
	 * a retained result (the last one, the memo's) would otherwise pin every mesh it ever carried.
	 */
	releaseBlobs: () => void;
}

/** The response JSON with each display item's `data` parsed into its batch, the mesh as bytes. */
export async function decodeBinarySolveResponse(bytes: Uint8Array): Promise<DecodedBinaryResponse> {
	const { flags, json, blobs } = readFrame(bytes);
	const jsonBytes = flags & BINARY_SOLVE_FLAG_GZIP_JSON ? await gunzip(json) : json;
	const response: unknown = JSON.parse(new TextDecoder().decode(jsonBytes));
	const batches: { compressedData?: unknown }[] = [];

	const values = (response as { values?: unknown } | null)?.values;
	if (Array.isArray(values)) {
		for (const value of values as Record<string, unknown>[]) {
			for (const tree of [value?.InnerTree, value?.innerTree]) {
				if (!tree || typeof tree !== 'object') continue;
				for (const branch of Object.values(tree)) {
					if (!Array.isArray(branch)) continue;
					for (const item of branch) {
						const batch = attachBlob(item, blobs);
						if (batch) batches.push(batch);
					}
				}
			}
		}
	}
	return {
		response,
		// An empty `compressedData` reads as a batch without meshes, never as a corrupt one.
		releaseBlobs: () => batches.forEach((batch) => (batch.compressedData = ''))
	};
}

function attachBlob(item: unknown, blobs: Uint8Array[]): { compressedData?: unknown } | null {
	const display = item as { type?: unknown; data?: unknown } | null;
	if (typeof display?.type !== 'string' || typeof display.data !== 'string') return null;
	if (!isDisplayItemType(display.type)) return null;
	const batch = JSON.parse(display.data) as { compressedData?: unknown };
	display.data = batch;
	if (!isBlobRef(batch.compressedData)) return null;
	const blob = blobs[batch.compressedData.$blob];
	if (!blob) throw new Error('Malformed binary solve response: a batch names a missing blob');
	batch.compressedData = blob;
	return batch;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}
