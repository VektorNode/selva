import type { RhinoModule } from 'rhino3dm';
import { getLogger } from '@/core';
import { makeDecodeError } from './rhino-objects';

interface XYZ {
	X: number;
	Y: number;
	Z: number;
}

type RhinoDecoder = (rhino: RhinoModule, data: unknown) => unknown;

const decoders = new Map<string, RhinoDecoder>([
	[
		'Rhino.Geometry.Point3d',
		(rhino, data) => {
			const d = data as Partial<XYZ> | null;
			if (!d || typeof d.X !== 'number') return null;
			return new rhino.Point([d.X, d.Y as number, d.Z as number]);
		}
	],
	[
		'Rhino.Geometry.Line',
		(rhino, data) => {
			const d = data as { From?: XYZ; To?: XYZ } | null;
			if (!d || !d.From || !d.To) return null;
			return new rhino.Line([d.From.X, d.From.Y, d.From.Z], [d.To.X, d.To.Y, d.To.Z]);
		}
	]
]);

function findDecoder(rhinoType: string): RhinoDecoder | undefined {
	if (decoders.has(rhinoType)) return decoders.get(rhinoType);
	for (const [key, dec] of decoders) {
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
		parsedData &&
		typeof parsedData === 'object' &&
		typeof (parsedData as { data?: unknown }).data === 'string'
	);
}

/**
 * Decode one typed payload from a solve response into a rhino3dm object.
 *
 * Every call yields exactly one of three outcomes:
 *
 * 1. **Decoded value** — a registered decoder recognized the shape, or the
 *    payload was a rhino3dm serialization envelope and `CommonObject.decode`
 *    succeeded.
 * 2. **Raw passthrough** (`=== parsedData`) — no decode path *applied*: no
 *    decoder matched the type (or the matched decoder returned `null`, meaning
 *    "not my shape") and the payload is not a decodable envelope. Not an error;
 *    the caller keeps the parsed JSON as-is.
 * 3. **{@link RhinoDecodeError} sentinel** — a decode was *attempted and threw*
 *    (a registered decoder threw and no envelope fallback could recover, or
 *    `CommonObject.decode` threw). Detect with {@link isRhinoDecodeError}.
 *
 * A decoder returning `null` is a soft miss, never an error: it falls through
 * to the envelope fallback. This matters for prefix collisions — e.g.
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
	// A throwing decoder is a hard failure (unlike a null return, which is a
	// soft "not my shape" miss) — remember it so that when no envelope fallback
	// can recover we return the error sentinel instead of silently passing the
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

	// Fallback using CommonObject.decode — fed the full envelope, not the unwrapped payload.
	try {
		if (isDecodableEnvelope(parsedData)) return rhino.CommonObject.decode(parsedData);
	} catch (error) {
		getLogger().warn(`Failed to decode ${rhinoType} with CommonObject:`, error);
		return makeDecodeError(rhinoType, parsedData);
	}

	return decoderThrew ? makeDecodeError(rhinoType, parsedData) : parsedData;
}
