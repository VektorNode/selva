import type { RhinoModule } from 'rhino3dm';
import { getLogger } from '@/core';

// -----------------------------------------------------------------------------
// Decoder Types
// -----------------------------------------------------------------------------

type RhinoDecoder = (rhino: RhinoModule, data: unknown) => unknown;

const decoderRegistry = new Map<string, RhinoDecoder>();

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

export function registerDecoder(typeName: string, decoder: RhinoDecoder): void {
	decoderRegistry.set(typeName, decoder);
}

registerDecoder('Rhino.Geometry.Point3d', (rhino, data) => {
	const d = data as any;
	if (!d || typeof d.X !== 'number') return null;
	return new rhino.Point([d.X, d.Y, d.Z]);
});

registerDecoder('Rhino.Geometry.Line', (rhino, data) => {
	const d = data as any;
	if (!d || !d.From || !d.To) return null;
	return new rhino.Line([d.From.X, d.From.Y, d.From.Z], [d.To.X, d.To.Y, d.To.Z]);
});

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

function findDecoder(rhinoType: string): RhinoDecoder | undefined {
	if (decoderRegistry.has(rhinoType)) return decoderRegistry.get(rhinoType);
	for (const [key, dec] of decoderRegistry) {
		if (rhinoType.startsWith(key)) return dec;
	}
	return undefined;
}

/**
 * Whether the parsed item looks like a rhino3dm serialization envelope
 * (`{version, archive3dm, opennurbs, data: "<base64>"}`). `CommonObject.decode` expects the whole
 * envelope: unwrapping `.data` first hands it the bare base64 string, which throws or decodes to
 * garbage (see the correct usage in display-items-parser.ts).
 */
function isDecodableEnvelope(parsedData: unknown): parsedData is object {
	return Boolean(
		parsedData && typeof parsedData === 'object' && typeof (parsedData as any).data === 'string'
	);
}

// -----------------------------------------------------------------------------
// Geometry Decoding
// -----------------------------------------------------------------------------

/**
 * Sentinel returned by {@link decodeRhinoGeometry} when a decode was attempted
 * and failed hard (a registered decoder or `CommonObject.decode` threw). Carries
 * the original payload so callers can log or retry. Use
 * {@link isRhinoDecodeError} to detect it.
 */
export interface RhinoDecodeError {
	__decodeError: true;
	type: string;
	raw: unknown;
}

/** Type guard for the {@link RhinoDecodeError} sentinel. */
export function isRhinoDecodeError(value: unknown): value is RhinoDecodeError {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as RhinoDecodeError).__decodeError === true
	);
}

function makeDecodeError(rhinoType: string, raw: unknown): RhinoDecodeError {
	return { __decodeError: true, type: rhinoType, raw };
}

/**
 * Decode one typed payload from a solve response into a rhino3dm object.
 *
 * Failure signaling is a single coherent scheme (issue 85): every call yields
 * exactly one of three outcomes:
 *
 * 1. **Decoded value**: a registered decoder recognized the shape, or the
 *    payload was a rhino3dm serialization envelope and `CommonObject.decode`
 *    succeeded.
 * 2. **Raw passthrough** (`=== parsedData`): no decode path applied. No
 *    decoder matched the type (or the matched decoder returned `null`, meaning
 *    "not my shape") and the payload is not a decodable envelope. Not an error;
 *    the caller keeps the parsed JSON as-is.
 * 3. **{@link RhinoDecodeError} sentinel**: a decode was attempted and threw
 *    (a registered decoder threw and no envelope fallback could recover, or
 *    `CommonObject.decode` threw). Detect with {@link isRhinoDecodeError}.
 *
 * A decoder returning `null` is a soft miss, never an error: it falls through
 * to the envelope fallback. This matters for prefix collisions, e.g.
 * `Rhino.Geometry.LineCurve` matches the `Rhino.Geometry.Line` decoder but is
 * a CommonObject envelope, not a `{From, To}` pair, and must reach
 * `CommonObject.decode`.
 */
export function decodeRhinoGeometry(
	parsedData: unknown,
	rhinoType: string,
	rhino: RhinoModule
): unknown {
	const decoder = findDecoder(rhinoType);
	// A throwing decoder is a hard failure (unlike a null return, a soft
	// "not my shape" miss): remember it so that when no envelope fallback can
	// recover we return the error sentinel instead of silently passing the
	// raw payload through as if no decode had ever been attempted.
	let decoderThrew = false;
	if (decoder) {
		try {
			const decoded = decoder(rhino, parsedData);
			if (decoded != null) return decoded;
		} catch (error) {
			getLogger().warn(`Failed to decode Rhino type ${rhinoType}:`, error);
			decoderThrew = true;
		}
	}

	// Fallback using CommonObject.decode: fed the full envelope, not the unwrapped payload.
	try {
		if (isDecodableEnvelope(parsedData)) return rhino.CommonObject.decode(parsedData);
	} catch (error) {
		getLogger().warn(`Failed to decode ${rhinoType} with CommonObject:`, error);
		return makeDecodeError(rhinoType, parsedData);
	}

	return decoderThrew ? makeDecodeError(rhinoType, parsedData) : parsedData;
}

// -----------------------------------------------------------------------------
// Disposal
// -----------------------------------------------------------------------------

/**
 * Free every rhino3dm WASM object reachable from `value`.
 *
 * rhino3dm objects are emscripten bindings: JS GC never reclaims their WASM
 * heap allocation, so everything decoded from a solve response (`getValues`,
 * `getValue`, `decodeRhinoObject`) must be deleted explicitly or the heap
 * grows monotonically across solves (e.g. a UI decoding per slider tick).
 *
 * Walks arrays and plain objects recursively; anything exposing a `delete()`
 * method is treated as a WASM binding and freed (skipped if already deleted).
 * Safe to call more than once and on values containing no WASM objects.
 */
export function disposeRhinoObjects(value: unknown): void {
	// Aliased references (same decoded object aggregated under two keys) must only be deleted once.
	const seen = new WeakSet<object>();

	const walk = (v: unknown): void => {
		if (!v || typeof v !== 'object') return;
		if (seen.has(v)) return;
		seen.add(v);

		const del = (v as { delete?: unknown }).delete;
		if (typeof del === 'function') {
			const isDeleted = (v as { isDeleted?: () => boolean }).isDeleted;
			if (typeof isDeleted !== 'function' || !isDeleted.call(v)) {
				(del as () => void).call(v);
			}
			return; // a WASM binding's internals are not ours to walk
		}

		if (Array.isArray(v)) {
			for (const item of v) walk(item);
			return;
		}
		// Only walk plain containers: class instances other than WASM bindings
		// (Dates, typed arrays, ...) hold nothing decodable.
		const proto = Object.getPrototypeOf(v);
		if (proto === Object.prototype || proto === null) {
			for (const item of Object.values(v)) walk(item);
		}
	};

	walk(value);
}

// -----------------------------------------------------------------------------
// Object Decoder
// -----------------------------------------------------------------------------

export interface DecodeRhinoOptions {
	keys?: string[];
	skipKeys?: string[];
	deep?: boolean;
}

/**
 * Decodes typed geometry fields in place. `keys`/`skipKeys` restrict which
 * fields are considered; with `deep`, recurses into nested objects and arrays.
 */
export function decodeRhinoObject<T extends Record<string, unknown>>(
	obj: T,
	rhino: RhinoModule,
	options: DecodeRhinoOptions = {}
): T {
	const { keys, skipKeys, deep } = options;
	const out: Record<string, unknown> = { ...obj };

	const shouldProcessKey = (k: string) => {
		if (skipKeys?.includes(k)) return false;
		if (keys && !keys.includes(k)) return false;
		return true;
	};

	for (const [key, value] of Object.entries(obj)) {
		if (!shouldProcessKey(key)) continue;
		if (!value || typeof value !== 'object') continue;

		const v: any = value;
		const maybeType = !Array.isArray(v) && typeof v.type === 'string' ? v.type : undefined;

		if (maybeType) {
			out[key] = decodeRhinoGeometry(v, maybeType, rhino);
			continue;
		}

		if (deep) {
			// Arrays must stay arrays (issue 61): recursing into decodeRhinoObject
			// would object-spread `[a, b]` into `{0: a, 1: b}`, breaking
			// Array.isArray/.map downstream. Map over elements instead.
			out[key] = Array.isArray(v)
				? decodeDeepArray(v, rhino, options)
				: decodeRhinoObject(v as any, rhino, options);
		}
	}

	return out as T;
}

/**
 * Deep-mode helper: decode every element of an array while preserving the
 * array shape. Type-tagged elements decode via {@link decodeRhinoGeometry},
 * nested arrays recurse, plain objects recurse through
 * {@link decodeRhinoObject} (so `keys`/`skipKeys` filtering still applies to
 * their fields), and primitives pass through untouched.
 */
function decodeDeepArray(
	arr: unknown[],
	rhino: RhinoModule,
	options: DecodeRhinoOptions
): unknown[] {
	return arr.map((el) => {
		if (!el || typeof el !== 'object') return el;
		if (Array.isArray(el)) return decodeDeepArray(el, rhino, options);
		const maybeType = typeof (el as any).type === 'string' ? (el as any).type : undefined;
		if (maybeType) return decodeRhinoGeometry(el, maybeType, rhino);
		return decodeRhinoObject(el as Record<string, unknown>, rhino, options);
	});
}
