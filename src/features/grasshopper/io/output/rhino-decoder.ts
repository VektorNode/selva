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
 * (`{version, archive3dm, opennurbs, data: "<base64>"}`). `CommonObject.decode` expects the WHOLE
 * envelope — unwrapping `.data` first hands it the bare base64 string, which throws or decodes to
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

export function decodeRhinoGeometry(
	parsedData: unknown,
	rhinoType: string,
	rhino: RhinoModule
): unknown {
	const decoder = findDecoder(rhinoType);
	if (decoder) {
		try {
			// A decoder returning null means "shape didn't match" — fall through to
			// the envelope fallback instead of returning null. This matters for
			// prefix collisions: `Rhino.Geometry.LineCurve` matches the
			// `Rhino.Geometry.Line` decoder but is a CommonObject envelope, not a
			// {From, To} pair, and must reach `CommonObject.decode` below.
			const decoded = decoder(rhino, parsedData);
			if (decoded != null) return decoded;
		} catch (error) {
			getLogger().warn(`Failed to decode Rhino type ${rhinoType}:`, error);
		}
	}

	// Fallback using CommonObject.decode — fed the full envelope, not the unwrapped payload.
	try {
		if (isDecodableEnvelope(parsedData)) return rhino.CommonObject.decode(parsedData);
	} catch (error) {
		getLogger().warn(`Failed to decode ${rhinoType} with CommonObject:`, error);
		return { __decodeError: true, type: rhinoType, raw: parsedData };
	}

	return parsedData;
}

// -----------------------------------------------------------------------------
// Disposal
// -----------------------------------------------------------------------------

/**
 * Free every rhino3dm WASM object reachable from `value`.
 *
 * rhino3dm objects are emscripten bindings — JS GC never reclaims their WASM
 * heap allocation, so everything decoded from a solve response (`getValues`,
 * `getValue`, `decodeRhinoObject`) must be deleted explicitly or the heap
 * grows monotonically across solves (e.g. a UI decoding per slider tick).
 *
 * Walks arrays and plain objects recursively; anything exposing a `delete()`
 * method is treated as a WASM binding and freed (skipped if already deleted).
 * Safe to call more than once and on values containing no WASM objects.
 */
export function disposeRhinoObjects(value: unknown): void {
	// Aliased references (the same decoded object aggregated under two keys)
	// must only be deleted once.
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
		// Only walk plain containers — class instances other than WASM bindings
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
		const maybeType = typeof v.type === 'string' ? v.type : undefined;

		if (maybeType) {
			out[key] = decodeRhinoGeometry(v, maybeType, rhino);
			continue;
		}

		if (deep) {
			out[key] = decodeRhinoObject(v as any, rhino, options);
		}
	}

	return out as T;
}
