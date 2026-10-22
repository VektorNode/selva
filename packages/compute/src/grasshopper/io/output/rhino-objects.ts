// Apart from rhino-decoder.ts so the public types never import `rhino3dm`: consumers install it only to decode geometry.

/**
 * Sentinel a Rhino geometry decode returns when a decode was attempted
 * and failed hard (a registered decoder or `CommonObject.decode` threw). Carries
 * the original payload so callers can log or retry. Use
 * {@link isRhinoDecodeError} to detect it.
 */
export interface RhinoDecodeError {
	__decodeError: true;
	/** The Rhino type name the failed decode was attempted for. */
	type: string;
	/** The original (undecoded) payload. */
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

export function makeDecodeError(rhinoType: string, raw: unknown): RhinoDecodeError {
	return { __decodeError: true, type: rhinoType, raw };
}

/**
 * Free every rhino3dm WASM object reachable from `value`.
 *
 * rhino3dm objects are emscripten bindings — JS GC never reclaims their WASM
 * heap allocation, so everything decoded from a solve response (`getValues`,
 * `getValue`) must be deleted explicitly or the heap
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
