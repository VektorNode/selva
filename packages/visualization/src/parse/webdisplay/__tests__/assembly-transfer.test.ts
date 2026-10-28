import { deflateSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as THREE from 'three';
import { encodeBatchPayload, type BuiltMeshBatch } from '@tests/helpers/mesh-batch-builder';
import { decodeBase64ToBinary } from '../../../shared/index.js';
import { COMPRESSED_MESH_MAGIC } from '../binary/header.js';
import { inflateSlvzAsync, slvzInflatedBytes } from '../binary/geometry.js';
import { assembleGeometries, finishGeometry } from '../mesh-assembly.js';
import { wrapInSlvm } from './fixtures.js';

import type { AssemblyInput } from '../mesh-assembly.js';
import type { MeshMetadata } from '../types.js';

// 20 spheres of ~18k triangles inflate to ~5 MB, past the size where inflate moves to a worker.
// Spheres rather than random strips: the closed-solid and crease passes are slow on noise.
function heavy(): BuiltMeshBatch {
	const vertices: number[] = [];
	const faces: number[] = [];
	const meshes: MeshMetadata[] = [];
	for (let i = 0; i < 20; i++) {
		const sphere = new THREE.SphereGeometry(40, 136, 68);
		const position = sphere.getAttribute('position');
		for (let v = 0; v < position.count; v++) {
			vertices.push(position.getX(v) + i * 100, position.getY(v), position.getZ(v));
		}
		const index = sphere.index!.array;
		const vertexStart = vertices.length / 3 - position.count;
		for (let k = 0; k < index.length; k++) faces.push(index[k]! + vertexStart);
		meshes.push({
			name: `sphere_${i}`,
			layer: '',
			vertexCount: position.count,
			indexCount: index.length,
			vertexStart,
			indexStart: faces.length - index.length,
			metadata: {}
		});
	}
	const materials = [
		{ color: '#cccccc', metalness: 0, roughness: 0.5, opacity: 1, transparent: false }
	];
	const groups = [{ materialId: 0, meshes }];
	const compressedData = encodeBatchPayload(new Float32Array(vertices), new Uint32Array(faces), {
		materials,
		groups: []
	});
	return {
		batch: { materials, groups, compressedData },
		rawVertices: new Float32Array(0),
		rawFaces: new Uint32Array(0)
	};
}

function slvzOf(raw: Uint8Array, declaredLength = raw.length): Uint8Array {
	const deflated = deflateSync(raw);
	const out = new Uint8Array(8 + deflated.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, COMPRESSED_MESH_MAGIC, true);
	view.setUint32(4, declaredLength, true);
	out.set(deflated, 8);
	return out;
}

function compressed(built: BuiltMeshBatch): BuiltMeshBatch {
	const z = slvzOf(decodeBase64ToBinary(built.batch.compressedData));
	return {
		...built,
		batch: { ...built.batch, compressedData: Buffer.from(z).toString('base64') }
	};
}

/** Behaves like a Worker as far as transfer goes: `structuredClone` detaches what it is given. */
function stubWorker(behaviour: 'works' | 'fails') {
	class StubWorker {
		onmessage: ((event: MessageEvent) => void) | null = null;
		onerror = null;
		postMessage(message: { id: number; input: AssemblyInput }, transfer: Transferable[]) {
			const { id, input } = structuredClone(message, { transfer });
			queueMicrotask(() => {
				if (behaviour === 'fails') {
					this.onmessage?.({ data: { id, error: 'boom' } } as MessageEvent);
					return;
				}
				const geometries = assembleGeometries(input).map((g, i) =>
					finishGeometry(
						g,
						input.jobs[i]!.windows.map((w) => w.indexCount)
					)
				);
				this.onmessage?.({ data: { id, geometries } } as MessageEvent);
			});
		}
		terminate() {}
	}
	vi.stubGlobal('Worker', StubWorker);
}

async function parseIn(
	frame: Uint8Array,
	worker: 'none' | 'works' | 'fails'
): Promise<THREE.Mesh[]> {
	vi.resetModules();
	if (worker === 'none') vi.stubGlobal('Worker', undefined);
	else stubWorker(worker);
	const { parseMeshBatchBlob } = await import('../batch-parser.js');
	return parseMeshBatchBlob(frame);
}

const bytesOf = (mesh: THREE.Mesh): Buffer[] => {
	const { attributes, index } = mesh.geometry;
	return [
		...Object.keys(attributes)
			.sort()
			.map((name) =>
				Buffer.from((attributes[name] as THREE.BufferAttribute).array.buffer.slice(0))
			),
		Buffer.from(index!.array.buffer.slice(0))
	];
};

// `toEqual` walks multi-MB buffers byte by byte, which takes seconds.
const sameGeometry = (a: THREE.Mesh, b: THREE.Mesh): boolean => {
	const left = bytesOf(a);
	const right = bytesOf(b);
	return left.length === right.length && left.every((buffer, i) => buffer.equals(right[i]!));
};

afterEach(() => vi.unstubAllGlobals());

describe('inflate and transfer to the assembly worker', () => {
	const built = heavy();
	let reference: Promise<THREE.Mesh[]> | undefined;
	const expected = () => (reference ??= parseIn(wrapInSlvm(built), 'none'));

	for (const [label, build] of [
		['an uncompressed chunk', () => wrapInSlvm(built)],
		['a compressed chunk', () => wrapInSlvm(compressed(built))]
	] as const) {
		it(`builds the same geometry in the worker from ${label}`, async () => {
			const frame = build();
			const length = frame.byteLength;
			const [mesh] = await parseIn(frame, 'works');

			expect(sameGeometry(mesh!, (await expected())[0]!)).toBe(true);
			// The frame is the caller's: the finished cache keys and copies it after the parse.
			expect(frame.byteLength).toBe(length);
		});

		it(`falls back to the main thread when the worker fails on ${label}`, async () => {
			const [mesh] = await parseIn(build(), 'fails');

			expect(sameGeometry(mesh!, (await expected())[0]!)).toBe(true);
		});
	}
});

describe('inflateSlvzAsync', () => {
	it('inflates a SLVZ blob', async () => {
		const raw = Uint8Array.from({ length: 5000 }, (_, i) => i % 7);
		const out = await inflateSlvzAsync(slvzOf(raw));

		expect(slvzInflatedBytes(slvzOf(raw))).toBe(5000);
		expect(Buffer.from(out)).toEqual(Buffer.from(raw));
	});

	it('rejects a blob inflating to a different size than its header declares', async () => {
		const raw = Uint8Array.from({ length: 5000 }, (_, i) => i % 7);

		await expect(inflateSlvzAsync(slvzOf(raw, 4000))).rejects.toThrow();
	});

	it('reports 0 for a blob that is not SLVZ', () => {
		expect(slvzInflatedBytes(new Uint8Array(64))).toBe(0);
	});
});
