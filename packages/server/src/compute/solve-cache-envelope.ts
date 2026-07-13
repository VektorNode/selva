/**
 * L2 cache entry format (R6). An entry is the gzipped response body plus a tiny
 * metadata header, so a hit is near-CPU-free: no `JSON.stringify`, no re-solve —
 * gzip clients get the stored bytes verbatim, and the header carries just enough
 * to rebuild the `ok` outcome (error/warning counts for the metric, uncompressed
 * length for the `Content-Length` on a gunzip fallback).
 *
 * Wire layout (opaque to the `ISolveResultCache` backend, which sees only bytes):
 *
 *   [ 4 bytes: header length N, big-endian uint32 ]
 *   [ N bytes: UTF-8 JSON EnvelopeHeader ]
 *   [ rest:    gzipped JSON response body ]
 *
 * The `algo` echo (M3) is already stripped at the source in the package's
 * `runSolve`, so the body never carries the base64 definition — entries stay
 * small without a strip step here.
 */

import { gunzipSync } from 'node:zlib';

/** Metadata stored beside the gzipped body. Small; parsed on every hit. */
export interface EnvelopeHeader {
	/** Grasshopper runtime error count, for the solve metric. */
	errorCount: number;
	/** Grasshopper runtime warning count, for the solve metric. */
	warningCount: number;
	/** Uncompressed JSON body length in bytes (Content-Length for a gunzip fallback). */
	serializedBytes: number;
	/**
	 * SHA-256 hex of the canonical input preimage (H2 defense-in-depth). A hit
	 * verifies this equals the requesting key's hash before serving — a wide-hash
	 * collision that produced the same storage key still can't serve the wrong
	 * geometry.
	 */
	inputHash: string;
}

/**
 * Encode a cache entry from the gzipped body + header. The body MUST already be
 * gzipped (the pipeline gzips before storing so every hit serves compressed
 * bytes; a rare non-gzip client gunzips on read).
 */
export function encodeSolveCacheEntry(header: EnvelopeHeader, gzippedBody: Uint8Array): Uint8Array {
	const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
	const out = Buffer.allocUnsafe(4 + headerJson.byteLength + gzippedBody.byteLength);
	out.writeUInt32BE(headerJson.byteLength, 0);
	headerJson.copy(out, 4);
	Buffer.from(gzippedBody.buffer, gzippedBody.byteOffset, gzippedBody.byteLength).copy(
		out,
		4 + headerJson.byteLength
	);
	return out;
}

/** A decoded entry: the parsed header + the still-gzipped body slice. */
export interface DecodedSolveCacheEntry {
	header: EnvelopeHeader;
	gzippedBody: Uint8Array;
}

/**
 * Decode a cache entry. Returns `null` on any malformed input (truncated, bad
 * length prefix, non-JSON header) — a corrupt entry is treated as a miss, never
 * an error, matching the best-effort cache contract.
 */
export function decodeSolveCacheEntry(bytes: Uint8Array): DecodedSolveCacheEntry | null {
	if (bytes.byteLength < 4) return null;
	const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const headerLen = buf.readUInt32BE(0);
	const headerEnd = 4 + headerLen;
	if (headerEnd > buf.byteLength) return null;
	let header: EnvelopeHeader;
	try {
		header = JSON.parse(buf.toString('utf8', 4, headerEnd)) as EnvelopeHeader;
	} catch {
		return null;
	}
	if (
		typeof header?.errorCount !== 'number' ||
		typeof header?.warningCount !== 'number' ||
		typeof header?.serializedBytes !== 'number' ||
		typeof header?.inputHash !== 'string'
	) {
		return null;
	}
	// Slice (view, no copy) of the gzipped remainder.
	const gzippedBody = new Uint8Array(
		bytes.buffer,
		bytes.byteOffset + headerEnd,
		bytes.byteLength - headerEnd
	);
	return { header, gzippedBody };
}

/** Gunzip a stored body back to the JSON string, for a non-gzip client (rare). */
export function gunzipEntryBody(gzippedBody: Uint8Array): string {
	return gunzipSync(gzippedBody).toString('utf8');
}
