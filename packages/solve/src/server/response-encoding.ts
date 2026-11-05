/**
 * Turns one solve's response into each caller's wire form. Runs after single-flight, not inside
 * it: coalesced callers can want different encodings, and each reports its own timing.
 */

import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { ServerTiming } from '@selvajs/compute/core';
import type { GrasshopperComputeResponse } from '@selvajs/compute/grasshopper';
import type { CacheVerdict, DefBytesVerdict } from './server-timing.js';

// gzipSync blocks the event loop for multi-MB bodies; promisify(gzip) doesn't.
const gzipAsync = promisify(gzip);

/**
 * Display output is base64 of already-deflated bytes, where higher levels find nothing more:
 * level 1 lands within 1% of the default's size, in up to a fifth of the time.
 */
const GZIP_LEVEL = 1;

/** Below this gzip isn't worth the CPU for the wire savings. */
const GZIP_MIN_BYTES = 1024;

// ============================================================================
// Wire contract version
// ============================================================================

/** Compute-response contract version. Bump (and document the change) whenever the envelope's shape changes in a way a consumer could observe. */
export const COMPUTE_CONTRACT_VERSION = 1 as const;
export const COMPUTE_VERSION_HEADER = 'X-Selva-Compute-Version';

// ============================================================================
// Envelope
// ============================================================================

/** What the `Server-Timing` header carries for one caller, as data: read this, don't parse that. */
export interface SolvePhaseMetrics {
	defLoadMs: number;
	treeBuildMs: number;
	solveMs: number;
	serializeMs: number;
	gzipMs: number;
	serverTotalMs: number;
	serializedBytes: number;
	/** Null when compression was skipped. */
	compressedBytes: number | null;
	/** The compute server's own timing; null when it reports none. */
	rhino: ServerTiming | null;
	settle: CacheVerdict;
	/** Absent for raw-bytes solves. */
	defBytes?: DefBytesVerdict;
}

/** A ready-to-send response: body + headers + the solve result + phase metrics. */
export interface SolveEnvelope {
	/** A gzip `Uint8Array` when `encoding === 'gzip'`, else the JSON string. */
	body: string | Uint8Array;
	encoding?: 'gzip';
	headers: Record<string, string>;
	result: GrasshopperComputeResponse;
	metrics: SolvePhaseMetrics;
}

export interface EncodedBody {
	body: string | Uint8Array;
	encoding?: 'gzip';
	serializedBytes: number;
	serializeMs: number;
	gzipMs: number;
}

export type TooLarge = 'too_large';

export function buildEnvelope(
	encoded: EncodedBody,
	result: GrasshopperComputeResponse,
	serverTiming: string,
	metrics: SolvePhaseMetrics
): SolveEnvelope {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'Server-Timing': serverTiming,
		[COMPUTE_VERSION_HEADER]: String(COMPUTE_CONTRACT_VERSION),
		Vary: 'Accept-Encoding'
	};
	const { body, encoding } = encoded;
	if (encoding === 'gzip') {
		// Content-Encoding tells a downstream proxy the body is already compressed,
		// so it won't gzip it again.
		headers['Content-Encoding'] = 'gzip';
	}
	headers['Content-Length'] = String(
		typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength
	);
	return { body, ...(encoding ? { encoding } : {}), headers, result, metrics };
}

// ============================================================================
// Encoding
// ============================================================================

/** Whether an `Accept-Encoding` header takes gzip. `gzip;q=0` is a client refusing it. */
export function acceptsGzip(acceptEncoding: string): boolean {
	return acceptEncoding.split(',').some((part) => {
		const [coding, ...params] = part.split(';').map((s) => s.trim().toLowerCase());
		if (coding !== 'gzip') return false;
		const q = params.find((p) => p.startsWith('q='));
		return q === undefined || Number(q.slice(2)) > 0;
	});
}

interface GzippedBody {
	body: Uint8Array;
	serializedBytes: number;
}

/**
 * A scheduler cache hit returns the same response object, so a repeat solve reuses its bytes rather
 * than paying to serialize and compress them again. Entries live exactly as long as the response.
 * Only the gzip form is kept: browsers always take it, and the JSON string would double the memory.
 * Holds the promise, so callers arriving during the compression share it.
 */
const gzippedBodies = new WeakMap<object, Promise<GzippedBody | TooLarge>>();

function gzipOnce(response: object, json: string, serializedBytes: number) {
	const pending = gzipAsync(Buffer.from(json), { level: GZIP_LEVEL }).then((body) => ({
		body,
		serializedBytes
	}));
	gzippedBodies.set(response, pending);
	// A failed compression must not stay memoized while the response is cached.
	pending.catch(() => gzippedBodies.delete(response));
	return pending;
}

export interface ResponseEncoder {
	/** Buffered, not streamed, so Content-Length is known upfront and a connection cut mid-transfer fails hard instead of silently truncating the JSON. */
	encode(acceptEncoding: string): Promise<EncodedBody | TooLarge>;
}

/**
 * One per solve. The JSON is kept here rather than beside the gzip body: it only has to outlive the
 * callers of this flight, who would otherwise each stringify the same response and hold a copy.
 */
export function createResponseEncoder(response: object, maxBytes: number): ResponseEncoder {
	let serialized: { json: string; bytes: number } | TooLarge | undefined;

	function serialize() {
		if (serialized !== undefined) return serialized;
		try {
			const json = JSON.stringify(response);
			const bytes = Buffer.byteLength(json);
			serialized = bytes > maxBytes ? 'too_large' : { json, bytes };
		} catch (err) {
			// V8 caps a string at ~512 MB; an oversized `file` output trips a RangeError
			// here. Treat it the same as the byte cap.
			if (!(err instanceof RangeError)) throw err;
			serialized = 'too_large';
		}
		return serialized;
	}

	return {
		async encode(acceptEncoding) {
			const wantsGzip = acceptsGzip(acceptEncoding);
			let gzipped = wantsGzip ? gzippedBodies.get(response) : undefined;
			let serializeMs = 0;

			if (!gzipped) {
				const serializeStart = performance.now();
				const plain = serialize();
				serializeMs = performance.now() - serializeStart;
				if (plain === 'too_large') {
					if (wantsGzip) gzippedBodies.set(response, Promise.resolve('too_large'));
					return 'too_large';
				}
				if (!wantsGzip || plain.bytes <= GZIP_MIN_BYTES) {
					return { body: plain.json, serializedBytes: plain.bytes, serializeMs, gzipMs: 0 };
				}
				gzipped = gzipOnce(response, plain.json, plain.bytes);
			}

			const gzipStart = performance.now();
			const verdict = await gzipped;
			if (verdict === 'too_large') return verdict;
			return {
				body: verdict.body,
				encoding: 'gzip',
				serializedBytes: verdict.serializedBytes,
				serializeMs,
				gzipMs: performance.now() - gzipStart
			};
		}
	};
}
