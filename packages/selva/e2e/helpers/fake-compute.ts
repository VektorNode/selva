import { createServer, type Server } from 'node:http';
import * as fs from 'node:fs';

// A hermetic stand-in for Rhino.Compute, faked at the HTTP transport seam — the
// same endpoints the server stack actually calls:
//
//   GET  /                    — liveness probe
//   POST /grasshopper/schema  — multipart upload gate; returns the bench UISchema fixture
//   POST /io                  — definition IO; replays a response captured from a live
//                               VektorNode Rhino.Compute for the same bench definition
//   POST /grasshopper         — solve; returns a DisplayBatch whose mesh count is a
//                               function of the `Count` input, so a test can prove an
//                               input change flowed browser → server → "compute" → render
//
// The DisplayBatch's `compressedData` is a genuine SLVA v3 blob (float32 vertices,
// uint32 indices) built by `buildDisplayBatch` below, so the response exercises the
// real binary-geometry parser in the browser.

const SCHEMA_FIXTURE = JSON.parse(
	fs.readFileSync(new URL('../fixtures/bench-schema.json', import.meta.url), 'utf8')
);
const IO_FIXTURE = JSON.parse(
	fs.readFileSync(new URL('../fixtures/bench-io.json', import.meta.url), 'utf8')
);

// SLVA wire constants — mirror binary-parser.ts / BinaryGeometryWriter.cs.
const BINARY_MESH_MAGIC = 0x41564c53; // "SLVA" little-endian
const BINARY_MESH_VERSION = 3;
const FLAG_FLOAT32 = 0x1;

interface FakeSolveRequest {
	algo?: string | null;
	pointer?: string | null;
	values?: Array<{
		ParamName?: string;
		InnerTree?: Record<string, Array<{ type?: string; data?: unknown }>>;
	}>;
}

/** meshCount = f(Count): 50 → 2, 75 → 3, 100 → 4; no Count → 1. */
export function meshCountForInput(count: number | null): number {
	if (count == null || !Number.isFinite(count)) return 1;
	return Math.max(1, Math.round(count / 25));
}

function readCountInput(body: FakeSolveRequest): number | null {
	const tree = body.values?.find((v) => v.ParamName === 'Count')?.InnerTree;
	const first = tree ? Object.values(tree)[0]?.[0]?.data : undefined;
	const n = typeof first === 'string' ? parseFloat(first) : typeof first === 'number' ? first : NaN;
	return Number.isFinite(n) ? n : null;
}

// Encodes meshCount disjoint triangles as an SLVA v3 blob — one material and one
// MaterialGroup per mesh so the count survives the viewer's merge-by-material pass.
function buildDisplayBatch(meshCount: number) {
	const materials = [];
	const groups = [];
	const vertices = new Float32Array(meshCount * 9);
	const indices = new Uint32Array(meshCount * 3);

	for (let i = 0; i < meshCount; i++) {
		const x = i * 30;
		vertices.set([x, 0, 0, x + 20, 0, 0, x, 20, 0], i * 9);
		indices.set([i * 3, i * 3 + 1, i * 3 + 2], i * 3);
		materials.push({
			color: '#4f46e5',
			metalness: 0.2,
			roughness: 0.6,
			opacity: 1,
			transparent: false
		});
		groups.push({
			materialId: i,
			meshes: [
				{
					name: `e2e-mesh-${i}`,
					layer: 'E2E',
					originalIndex: i,
					vertexCount: 3,
					indexCount: 3,
					vertexStart: i * 3,
					indexStart: i * 3
				}
			]
		});
	}

	const sourceComponentId = 'e2e-fake-display';
	const metadataBytes = new TextEncoder().encode(
		JSON.stringify({ materials, groups, sourceComponentId })
	);

	const byteLength =
		12 + metadataBytes.byteLength + 4 + 48 + 4 + vertices.byteLength + 4 + indices.byteLength;
	const buffer = new ArrayBuffer(byteLength);
	const view = new DataView(buffer);
	const bytes = new Uint8Array(buffer);
	let offset = 0;

	view.setUint32(offset, BINARY_MESH_MAGIC, true);
	offset += 4;
	view.setUint32(offset, BINARY_MESH_VERSION, true);
	offset += 4;
	view.setUint32(offset, metadataBytes.byteLength, true);
	offset += 4;
	bytes.set(metadataBytes, offset);
	offset += metadataBytes.byteLength;

	view.setUint32(offset, FLAG_FLOAT32, true);
	offset += 4;
	for (const component of [0, 0, 0, 1, 1, 1]) {
		view.setFloat64(offset, component, true);
		offset += 8;
	}

	view.setUint32(offset, meshCount * 3, true);
	offset += 4;
	bytes.set(new Uint8Array(vertices.buffer), offset);
	offset += vertices.byteLength;

	view.setUint32(offset, indices.length, true);
	offset += 4;
	bytes.set(new Uint8Array(indices.buffer), offset);

	return {
		materials,
		groups,
		compressedData: Buffer.from(buffer).toString('base64'),
		sourceComponentId
	};
}

function readBody(req: import('node:http').IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

export interface FakeCompute {
	url: string;
	/** Count values seen by /grasshopper, in arrival order. */
	solveInputs: (number | null)[];
	close(): Promise<void>;
}

export async function startFakeCompute(): Promise<FakeCompute> {
	const solveInputs: (number | null)[] = [];

	const server: Server = createServer(async (req, res) => {
		const path = new URL(req.url ?? '/', 'http://localhost').pathname;

		if (req.method === 'GET' && path === '/') {
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end('compute.rhino3d running — e2e fake');
			return;
		}

		if (req.method === 'POST' && path === '/grasshopper/schema') {
			await readBody(req);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify([{ fileName: 'definition.gh', schemas: [SCHEMA_FIXTURE] }]));
			return;
		}

		if (req.method === 'POST' && path === '/io') {
			await readBody(req);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(IO_FIXTURE));
			return;
		}

		if (req.method === 'POST' && path === '/grasshopper') {
			const raw = await readBody(req);
			let body: FakeSolveRequest;
			try {
				body = JSON.parse(raw.toString('utf8'));
			} catch {
				res.writeHead(400).end('invalid JSON');
				return;
			}
			const count = readCountInput(body);
			solveInputs.push(count);
			const batch = buildDisplayBatch(meshCountForInput(count));
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					modelunits: 'Millimeters',
					dataversion: 8,
					algo: body.algo ?? null,
					filename: null,
					pointer: 'md5_E2EFAKECOMPUTE00000000000000000',
					cachesolve: true,
					values: [
						{
							ParamName: 'Web Display',
							InnerTree: {
								'{0}': [
									{
										type: 'Selva.GH.Features.Display.Services.DisplayBatch',
										data: JSON.stringify(batch)
									}
								]
							}
						}
					],
					warnings: [],
					errors: []
				})
			);
			return;
		}

		res.writeHead(404).end('not found');
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (address == null || typeof address === 'string') throw new Error('no listen address');

	return {
		url: `http://127.0.0.1:${address.port}`,
		solveInputs,
		close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
	};
}
