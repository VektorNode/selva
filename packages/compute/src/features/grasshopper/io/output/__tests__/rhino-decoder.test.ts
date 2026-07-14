/**
 * Tests for the Rhino geometry decoder — the hot path that turns typed values in
 * a solve response into JS/Rhino objects. Covers the registry (exact + prefix
 * lookup, the public `registerDecoder` seam), the three-tier `decodeRhinoGeometry`
 * fallback (registered decoder → `CommonObject.decode` → raw passthrough, plus the
 * `__decodeError` sentinel), and `decodeRhinoObject`'s key filtering / deep walk.
 *
 * `rhino` is a tiny stand-in: the decoders only construct `Point`/`Line` and call
 * `CommonObject.decode`, so no rhino3dm WASM is needed.
 */
import { describe, expect, it, vi } from 'vitest';
import type { RhinoModule } from 'rhino3dm';

import {
	registerDecoder,
	decodeRhinoGeometry,
	decodeRhinoObject,
	isRhinoDecodeError
} from '../rhino-decoder';

/** Minimal rhino3dm stand-in. `Point`/`Line` record their args so we can assert on them. */
function fakeRhino(decode: (payload: unknown) => unknown = () => ({ decoded: true })): RhinoModule {
	return {
		Point: class {
			constructor(public location: number[]) {}
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

	it('a decoder returning null falls through instead of short-circuiting (issue 60)', () => {
		// The Point3d decoder guards on `typeof d.X === 'number'`; a bad shape yields
		// null, which now means "not my shape — try the fallback". A non-envelope
		// payload then passes through raw. Previously the null was returned directly,
		// so prefix collisions (LineCurve → Line decoder) silently decoded to null.
		expect(decodeRhinoGeometry({ nope: true }, 'Rhino.Geometry.Point3d', fakeRhino())).toEqual({
			nope: true
		});
	});

	it('a prefix-collided type reaches the CommonObject fallback (issue 60)', () => {
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

	it('falls back to CommonObject.decode when a registered decoder throws', () => {
		registerDecoder('My.Throwing.Type', () => {
			throw new Error('decoder blew up');
		});
		const decode = vi.fn(() => ({ recovered: true }));
		const rhino = fakeRhino(decode);
		// Decoder throws → caught → CommonObject.decode runs on the full envelope.
		const envelope = { version: 10000, archive3dm: 70, opennurbs: 4294967295, data: 'AAEC' };
		const result = decodeRhinoGeometry(envelope, 'My.Throwing.Type', rhino);
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

describe('decodeRhinoGeometry — failure signaling contract (issue 85)', () => {
	it('a throwing decoder with no envelope fallback is a hard failure, not a silent passthrough', () => {
		// Previously this fell through to `return parsedData` — indistinguishable
		// from a soft "no decoder matched" miss. A decode was attempted and threw,
		// so under the coherent scheme it must yield the sentinel.
		registerDecoder('My.Throwing.NoEnvelope', () => {
			throw new Error('decoder blew up');
		});
		const raw = { not: 'an envelope' };
		const result = decodeRhinoGeometry(raw, 'My.Throwing.NoEnvelope', fakeRhino());
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

describe('registerDecoder', () => {
	it('registers a custom decoder that decodeRhinoGeometry then uses', () => {
		registerDecoder('My.Custom.Widget', (_rhino, data) => ({ widget: data }));
		const result = decodeRhinoGeometry({ a: 1 }, 'My.Custom.Widget', fakeRhino());
		expect(result).toEqual({ widget: { a: 1 } });
	});

	it('lets a later registration override an earlier one for the same type', () => {
		registerDecoder('My.Override.Type', () => 'first');
		registerDecoder('My.Override.Type', () => 'second');
		expect(decodeRhinoGeometry({}, 'My.Override.Type', fakeRhino())).toBe('second');
	});
});

describe('decodeRhinoObject', () => {
	it('decodes type-tagged geometry fields and leaves plain fields untouched', () => {
		const rhino = fakeRhino();
		const obj = {
			pt: { type: 'Rhino.Geometry.Point3d', X: 1, Y: 2, Z: 3 },
			label: 'keep me',
			count: 4
		};
		const out = decodeRhinoObject(obj, rhino) as Record<string, any>;
		expect(out.pt.location).toEqual([1, 2, 3]);
		expect(out.label).toBe('keep me');
		expect(out.count).toBe(4);
	});

	it('does not mutate the input object', () => {
		const rhino = fakeRhino();
		const obj = { pt: { type: 'Rhino.Geometry.Point3d', X: 0, Y: 0, Z: 0 } };
		decodeRhinoObject(obj, rhino);
		// Original still carries the raw shape, not a decoded Point.
		expect(obj.pt).toEqual({ type: 'Rhino.Geometry.Point3d', X: 0, Y: 0, Z: 0 });
	});

	it('skips keys listed in skipKeys', () => {
		const rhino = fakeRhino();
		const obj = { a: { type: 'Rhino.Geometry.Point3d', X: 1, Y: 1, Z: 1 } };
		const out = decodeRhinoObject(obj, rhino, { skipKeys: ['a'] }) as Record<string, any>;
		// Untouched — still the raw object, not a decoded Point.
		expect(out.a).toEqual({ type: 'Rhino.Geometry.Point3d', X: 1, Y: 1, Z: 1 });
	});

	it('processes only keys in the keys allowlist', () => {
		const rhino = fakeRhino();
		const obj = {
			a: { type: 'Rhino.Geometry.Point3d', X: 1, Y: 1, Z: 1 },
			b: { type: 'Rhino.Geometry.Point3d', X: 2, Y: 2, Z: 2 }
		};
		const out = decodeRhinoObject(obj, rhino, { keys: ['a'] }) as Record<string, any>;
		expect(out.a.location).toEqual([1, 1, 1]); // decoded
		expect(out.b).toEqual({ type: 'Rhino.Geometry.Point3d', X: 2, Y: 2, Z: 2 }); // untouched
	});

	it('recurses into nested plain objects only when deep is set', () => {
		const rhino = fakeRhino();
		const obj = {
			nested: { pt: { type: 'Rhino.Geometry.Point3d', X: 9, Y: 9, Z: 9 } }
		};

		const shallow = decodeRhinoObject(obj, rhino) as Record<string, any>;
		expect(shallow.nested.pt).toEqual({ type: 'Rhino.Geometry.Point3d', X: 9, Y: 9, Z: 9 });

		const deep = decodeRhinoObject(obj, rhino, { deep: true }) as Record<string, any>;
		expect(deep.nested.pt.location).toEqual([9, 9, 9]);
	});

	it('ignores null and non-object field values', () => {
		const rhino = fakeRhino();
		const obj = { a: null, b: 5, c: 'text' } as unknown as Record<string, unknown>;
		const out = decodeRhinoObject(obj, rhino);
		expect(out).toEqual({ a: null, b: 5, c: 'text' });
	});
});

describe('decodeRhinoObject — deep mode preserves arrays (issue 61)', () => {
	const pt = (n: number) => ({ type: 'Rhino.Geometry.Point3d', X: n, Y: n, Z: n });

	it('keeps an array of geometry an array, with every element decoded', () => {
		// Regression: deep mode recursed arrays into decodeRhinoObject, whose
		// `{ ...obj }` spread turned [pt1, pt2] into {0: pt1, 1: pt2}.
		const rhino = fakeRhino();
		const out = decodeRhinoObject({ points: [pt(1), pt(2)] }, rhino, { deep: true }) as Record<
			string,
			any
		>;

		expect(Array.isArray(out.points)).toBe(true);
		expect(out.points).toHaveLength(2);
		expect(out.points[0].location).toEqual([1, 1, 1]);
		expect(out.points[1].location).toEqual([2, 2, 2]);
	});

	it('recurses through nested arrays and plain objects inside arrays', () => {
		const rhino = fakeRhino();
		const obj = {
			groups: [[pt(1)], { inner: pt(2) }, 'plain', 3, null]
		};
		const out = decodeRhinoObject(obj, rhino, { deep: true }) as Record<string, any>;

		expect(Array.isArray(out.groups)).toBe(true);
		expect(Array.isArray(out.groups[0])).toBe(true);
		expect(out.groups[0][0].location).toEqual([1, 1, 1]);
		expect(out.groups[1].inner.location).toEqual([2, 2, 2]);
		// Primitives and null pass through untouched.
		expect(out.groups.slice(2)).toEqual(['plain', 3, null]);
	});

	it('leaves arrays untouched in shallow mode (unchanged behavior)', () => {
		const rhino = fakeRhino();
		const obj = { points: [pt(1)] };
		const out = decodeRhinoObject(obj, rhino) as Record<string, any>;
		expect(out.points).toEqual([pt(1)]);
	});

	it('does not mutate the input arrays', () => {
		const rhino = fakeRhino();
		const original = [pt(1)];
		decodeRhinoObject({ points: original }, rhino, { deep: true });
		expect(original[0]).toEqual(pt(1));
	});
});
