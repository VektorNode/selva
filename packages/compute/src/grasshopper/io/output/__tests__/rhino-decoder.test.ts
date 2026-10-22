// `rhino` is a stand-in: the decoders only construct `Point`/`Line` and call
// `CommonObject.decode`, so no rhino3dm WASM is needed.
import { describe, expect, it, vi } from 'vitest';
import type { RhinoModule } from 'rhino3dm';

import { decodeRhinoGeometry } from '../rhino-decoder';
import { isRhinoDecodeError } from '../rhino-objects';

/** `Point`/`Line` record their args so we can assert on them. */
function fakeRhino(
	decode: (payload: unknown) => unknown = () => ({ decoded: true }),
	{ pointThrows = false } = {}
): RhinoModule {
	return {
		Point: class {
			constructor(public location: number[]) {
				if (pointThrows) throw new Error('decoder blew up');
			}
		},
		Line: class {
			constructor(
				public from: number[],
				public to: number[]
			) {}
		},
		CommonObject: { decode }
	} as unknown as RhinoModule;
}

describe('decodeRhinoGeometry — registered decoders', () => {
	it('decodes a Point3d via its registered decoder', () => {
		const rhino = fakeRhino();
		const result = decodeRhinoGeometry({ X: 1, Y: 2, Z: 3 }, 'Rhino.Geometry.Point3d', rhino) as {
			location: number[];
		};
		expect(result.location).toEqual([1, 2, 3]);
	});

	it('decodes a Line via its registered decoder', () => {
		const rhino = fakeRhino();
		const data = { From: { X: 0, Y: 0, Z: 0 }, To: { X: 1, Y: 1, Z: 1 } };
		const result = decodeRhinoGeometry(data, 'Rhino.Geometry.Line', rhino) as {
			from: number[];
			to: number[];
		};
		expect(result.from).toEqual([0, 0, 0]);
		expect(result.to).toEqual([1, 1, 1]);
	});

	it('a decoder returning null falls through instead of short-circuiting', () => {
		// A bad shape makes the Point3d decoder return null ("not my shape"); a
		// non-envelope payload then passes through raw.
		expect(decodeRhinoGeometry({ nope: true }, 'Rhino.Geometry.Point3d', fakeRhino())).toEqual({
			nope: true
		});
	});

	it('a prefix-collided type reaches the CommonObject fallback', () => {
		// Rhino.Geometry.LineCurve startsWith-matches the Rhino.Geometry.Line decoder,
		// whose {From, To} guard fails on the CommonObject envelope — the envelope must
		// then reach CommonObject.decode instead of decoding to null.
		const envelope = { version: 10000, archive3dm: 70, opennurbs: 0, data: 'BASE64' };
		const decode = vi.fn(() => ({ decodedCurve: true }));
		const result = decodeRhinoGeometry(envelope, 'Rhino.Geometry.LineCurve', fakeRhino(decode));
		expect(decode).toHaveBeenCalledWith(envelope);
		expect(result).toEqual({ decodedCurve: true });
	});

	it('matches a decoder by prefix when the exact type is not registered', () => {
		// A subtype like "...Point3d, Foo" still resolves to the Point3d decoder via startsWith.
		const result = decodeRhinoGeometry(
			{ X: 5, Y: 6, Z: 7 },
			'Rhino.Geometry.Point3d, Rhino.Common',
			fakeRhino()
		) as { location: number[] };
		expect(result.location).toEqual([5, 6, 7]);
	});

	it('falls back to CommonObject.decode when a decoder throws', () => {
		const decode = vi.fn(() => ({ recovered: true }));
		const rhino = fakeRhino(decode, { pointThrows: true });
		const envelope = { X: 1, Y: 2, Z: 3, data: 'AAEC' };
		const result = decodeRhinoGeometry(envelope, 'Rhino.Geometry.Point3d', rhino);
		expect(decode).toHaveBeenCalledWith(envelope);
		expect(result).toEqual({ recovered: true });
	});
});

describe('decodeRhinoGeometry — CommonObject fallback', () => {
	it('decodes an unregistered type via CommonObject.decode, fed the FULL envelope', () => {
		// CommonObject.decode expects the whole rhino3dm serialization envelope
		// {version, archive3dm, opennurbs, data} — not the unwrapped base64 `data` string.
		const decode = vi.fn((p) => ({ brep: p }));
		const rhino = fakeRhino(decode);
		const envelope = { version: 10000, archive3dm: 70, opennurbs: 4294967295, data: 'AAEC' };
		const result = decodeRhinoGeometry(envelope, 'Rhino.Geometry.Brep', rhino);
		expect(decode).toHaveBeenCalledWith(envelope);
		expect(result).toEqual({ brep: envelope });
	});

	it('passes through a payload that is not an envelope (no base64 `data` string)', () => {
		const decode = vi.fn((p) => ({ ok: p }));
		const rhino = fakeRhino(decode);
		const raw = { value: { v: 1 } };
		expect(decodeRhinoGeometry(raw, 'Rhino.Geometry.Mesh', rhino)).toBe(raw);
		expect(decode).not.toHaveBeenCalled();
	});

	it('returns the raw input when there is no decoder and no extractable payload', () => {
		const raw = { type: 'Rhino.Geometry.Unknown' };
		expect(decodeRhinoGeometry(raw, 'Rhino.Geometry.Unknown', fakeRhino())).toBe(raw);
	});

	it('returns a __decodeError sentinel when CommonObject.decode throws', () => {
		const rhino = fakeRhino(() => {
			throw new Error('bad archive');
		});
		const raw = { data: 'not-a-valid-archive' };
		const result = decodeRhinoGeometry(raw, 'Rhino.Geometry.Brep', rhino) as {
			__decodeError: boolean;
			type: string;
			raw: unknown;
		};
		expect(result.__decodeError).toBe(true);
		expect(result.type).toBe('Rhino.Geometry.Brep');
		expect(result.raw).toBe(raw);
	});
});

describe('decodeRhinoGeometry — failure signaling', () => {
	it('a throwing decoder with no envelope fallback is a hard failure, not a silent passthrough', () => {
		const raw = { X: 1, Y: 2, Z: 3 };
		const result = decodeRhinoGeometry(
			raw,
			'Rhino.Geometry.Point3d',
			fakeRhino(undefined, { pointThrows: true })
		);
		expect(isRhinoDecodeError(result)).toBe(true);
		expect((result as { raw: unknown }).raw).toBe(raw);
	});

	it('isRhinoDecodeError distinguishes the sentinel from passthrough and decoded values', () => {
		const rhino = fakeRhino(() => {
			throw new Error('bad archive');
		});
		const sentinel = decodeRhinoGeometry({ data: 'bad' }, 'Rhino.Geometry.Brep', rhino);
		expect(isRhinoDecodeError(sentinel)).toBe(true);

		// Passthrough (soft miss) and decoded results are not errors.
		expect(
			isRhinoDecodeError(decodeRhinoGeometry({ v: 1 }, 'Rhino.Geometry.Mesh', fakeRhino()))
		).toBe(false);
		expect(
			isRhinoDecodeError(
				decodeRhinoGeometry({ X: 1, Y: 2, Z: 3 }, 'Rhino.Geometry.Point3d', fakeRhino())
			)
		).toBe(false);
		expect(isRhinoDecodeError(null)).toBe(false);
		expect(isRhinoDecodeError('nope')).toBe(false);
	});
});
