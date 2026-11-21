/**
 * Turns one solve's response into each caller's wire form. Runs after single-flight, not inside
 * it: coalesced callers can want different encodings, and each reports its own timing.
 */

import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { ServerTiming } from '@selvajs/compute/core';
import type { GrasshopperComputeResponse } from '@selvajs/compute/grasshopper';
import type { CacheVerdict, DefBytesVerdict } from './server-timing.js';
import {
	align8,
	BINARY_SOLVE_FLAG_GZIP_JSON,
	BINARY_SOLVE_MEDIA_TYPE,
	headerBytes,
	isDisplayItemType,
	writeHeader
} from '../shared/binary-response.js';

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

/**
 * The wire forms one solve can be sent in. Callers that store an encoded body (idempotent replay)
 * key it on this, so a stored reply never reaches a client that can't read it.
 */
export type ResponseVariant = 'binary' | 'gzip' | 'identity';

/** A ready-to-send response: body + headers + the solve result + phase metrics. */
export interface SolveEnvelope {
	/** The JSON string for `identity`, else bytes. */
	body: string | Uint8Array;
	variant: ResponseVariant;
	/** @deprecated Read `variant`. Set exactly when `variant` is `gzip`. */
	encoding?: 'gzip';
	headers: Record<string, string>;
	result: GrasshopperComputeResponse;
	metrics: SolvePhaseMetrics;
}

export interface EncodedBody {
	body: string | Uint8Array;
	variant: ResponseVariant;
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
	const { body, variant } = encoded;
	const headers: Record<string, string> = {
		'Content-Type': variant === 'binary' ? BINARY_SOLVE_MEDIA_TYPE : 'application/json',
		'Server-Timing': serverTiming,
		[COMPUTE_VERSION_HEADER]: String(COMPUTE_CONTRACT_VERSION),
		Vary: 'Accept, Accept-Encoding'
	};
	if (variant === 'gzip') {
		// Content-Encoding tells a downstream proxy the body is already compressed,
		// so it won't gzip it again.
		headers['Content-Encoding'] = 'gzip';
	}
	headers['Content-Length'] = String(
		typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength
	);
	return {
		body,
		variant,
		...(variant === 'gzip' ? { encoding: 'gzip' } : {}),
		headers,
		result,
		metrics
	};
}

// ============================================================================
// Encoding
// ============================================================================

/** Whether a comma-separated header lists `token` without `q=0`, which is a client refusing it. */
function listsToken(header: string, token: string): boolean {
	return header.split(',').some((part) => {
		const [value, ...params] = part.split(';').map((s) => s.trim().toLowerCase());
		if (value !== token) return false;
		const q = params.find((p) => p.startsWith('q='));
		return q === undefined || Number(q.slice(2)) > 0;
	});
}

/** Whether an `Accept-Encoding` header takes gzip. */
export function acceptsGzip(acceptEncoding: string): boolean {
	return listsToken(acceptEncoding, 'gzip');
}

/** The form a request with these headers is answered in. Only an explicit `Accept` gets binary. */
export function responseVariant(headers: {
	accept?: string;
	acceptEncoding?: string;
}): ResponseVariant {
	if (listsToken(headers.accept ?? '', BINARY_SOLVE_MEDIA_TYPE)) return 'binary';
	return acceptsGzip(headers.acceptEncoding ?? '') ? 'gzip' : 'identity';
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
const binaryBodies = new WeakMap<object, Promise<BinaryBody | TooLarge>>();

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

interface BinaryBody {
	body: Uint8Array;
	serializedBytes: number;
	serializeMs: number;
	gzipMs: number;
}

/**
 * Splits every display batch's base64 blob out of `response` and frames the rest (wire format in
 * `shared/binary-response.ts`). The blobs are already deflated, so only the JSON section is gzipped.
 */
async function encodeBinary(response: object, maxBytes: number): Promise<BinaryBody | TooLarge> {
	const serializeStart = performance.now();
	const blobs: Buffer[] = [];
	let jsonBuffer: Buffer;
	try {
		jsonBuffer = Buffer.from(JSON.stringify(withBlobsSplit(response, blobs)));
	} catch (err) {
		// V8's string cap, as in `serialize` below.
		if (!(err instanceof RangeError)) throw err;
		return 'too_large';
	}
	const blobBytes = blobs.reduce((sum, blob) => sum + blob.byteLength, 0);
	const serializedBytes = jsonBuffer.byteLength + blobBytes;
	if (serializedBytes > maxBytes) return 'too_large';
	const serializeMs = performance.now() - serializeStart;

	const gzipJson = jsonBuffer.byteLength > GZIP_MIN_BYTES;
	const gzipStart = performance.now();
	const json = gzipJson ? await gzipAsync(jsonBuffer, { level: GZIP_LEVEL }) : jsonBuffer;
	const gzipMs = gzipJson ? performance.now() - gzipStart : 0;

	const lengths = blobs.map((blob) => blob.byteLength);
	let total = headerBytes(blobs.length) + align8(json.byteLength);
	for (const length of lengths) total += align8(length);
	const body = new Uint8Array(total);
	writeHeader(body, gzipJson ? BINARY_SOLVE_FLAG_GZIP_JSON : 0, json.byteLength, lengths);
	let offset = headerBytes(blobs.length);
	body.set(json, offset);
	offset += align8(json.byteLength);
	for (const blob of blobs) {
		body.set(blob, offset);
		offset += align8(blob.byteLength);
	}
	return { body, serializedBytes, serializeMs, gzipMs };
}

/** A copy of `response` whose display batches point into `blobs`. Leaves `response` untouched: the solve cache still holds it. */
function withBlobsSplit(response: object, blobs: Buffer[]): object {
	const { values } = response as { values?: unknown };
	if (!Array.isArray(values)) return response;
	return {
		...response,
		values: values.map((value: Record<string, unknown>) => {
			const out = { ...value };
			for (const key of ['InnerTree', 'innerTree']) {
				const tree = value[key] as Record<string, unknown> | undefined;
				if (!tree || typeof tree !== 'object') continue;
				out[key] = Object.fromEntries(
					Object.entries(tree).map(([path, branch]) => [
						path,
						Array.isArray(branch) ? branch.map((item) => splitDisplayItem(item, blobs)) : branch
					])
				);
			}
			return out;
		})
	};
}

function splitDisplayItem(item: unknown, blobs: Buffer[]): unknown {
	const { type, data } = (item ?? {}) as { type?: unknown; data?: unknown };
	if (typeof type !== 'string' || typeof data !== 'string' || !isDisplayItemType(type)) return item;
	let batch: Record<string, unknown>;
	try {
		batch = JSON.parse(data);
	} catch {
		return item;
	}
	if (typeof batch?.compressedData !== 'string' || batch.compressedData === '') return item;
	blobs.push(Buffer.from(batch.compressedData, 'base64'));
	return {
		...(item as object),
		data: JSON.stringify({ ...batch, compressedData: { $blob: blobs.length - 1 } })
	};
}

export interface ResponseEncoder {
	/** Buffered, not streamed, so Content-Length is known upfront and a connection cut mid-transfer fails hard instead of silently truncating the JSON. */
	encode(variant: ResponseVariant): Promise<EncodedBody | TooLarge>;
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
		async encode(variant) {
			if (variant === 'binary') {
				let pending = binaryBodies.get(response);
				const cached = pending !== undefined;
				if (!pending) {
					pending = encodeBinary(response, maxBytes);
					binaryBodies.set(response, pending);
					pending.catch(() => binaryBodies.delete(response));
				}
				const verdict = await pending;
				if (verdict === 'too_large') return verdict;
				return {
					body: verdict.body,
					variant: 'binary',
					serializedBytes: verdict.serializedBytes,
					// A reused body cost this caller nothing.
					serializeMs: cached ? 0 : verdict.serializeMs,
					gzipMs: cached ? 0 : verdict.gzipMs
				};
			}

			const wantsGzip = variant === 'gzip';
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
					return {
						body: plain.json,
						variant: 'identity',
						serializedBytes: plain.bytes,
						serializeMs,
						gzipMs: 0
					};
				}
				gzipped = gzipOnce(response, plain.json, plain.bytes);
			}

			const gzipStart = performance.now();
			const verdict = await gzipped;
			if (verdict === 'too_large') return verdict;
			return {
				body: verdict.body,
				variant: 'gzip',
				serializedBytes: verdict.serializedBytes,
				serializeMs,
				gzipMs: performance.now() - gzipStart
			};
		}
	};
}
