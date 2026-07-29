import { meshAssemblyWorkerSource } from '../mesh-assembly.js';

import type { AssembledGeometry } from '../mesh-assembly.js';

/**
 * Below this triangle count the synchronous path finishes in ~10 ms — a worker round-trip (two
 * buffer copies + wake) isn't worth it. Above it, delta-decode + dequantize + merge + normals run
 * in the worker and the main thread only wraps returned buffers (or reuses cached geometries).
 */
export const ASSEMBLY_WORKER_MIN_TRIANGLES = 50_000;

interface PendingAssembly {
	resolve: (geometries: AssembledGeometry[]) => void;
	reject: (error: Error) => void;
}

let assemblyWorker: Worker | null | undefined; // undefined = not yet tried, null = unavailable
const pendingAssemblies = new Map<number, PendingAssembly>();
let nextAssemblyRequestId = 1;

export function getAssemblyWorker(): Worker | null {
	if (assemblyWorker !== undefined) return assemblyWorker;
	if (
		typeof Worker === 'undefined' ||
		typeof Blob === 'undefined' ||
		typeof URL === 'undefined' ||
		typeof URL.createObjectURL !== 'function'
	) {
		assemblyWorker = null;
		return null;
	}
	try {
		// Blob URL keeps the library bundler-agnostic; deliberately never revoked (see `@selvajs/compute`'s edges.ts).
		const url = URL.createObjectURL(
			new Blob([meshAssemblyWorkerSource()], { type: 'text/javascript' })
		);
		const worker = new Worker(url);
		worker.onmessage = (event: MessageEvent) => {
			const { id, geometries, error } = event.data as {
				id: number;
				geometries?: AssembledGeometry[];
				error?: string;
			};
			const pending = pendingAssemblies.get(id);
			if (!pending) return;
			pendingAssemblies.delete(id);
			if (geometries) pending.resolve(geometries);
			else pending.reject(new Error(error ?? 'mesh assembly failed in worker'));
		};
		worker.onerror = () => {
			for (const pending of pendingAssemblies.values()) {
				pending.reject(new Error('mesh assembly worker crashed'));
			}
			pendingAssemblies.clear();
			worker.terminate();
			assemblyWorker = null; // don't retry this session — callers fall back to the sync path
		};
		assemblyWorker = worker;
	} catch {
		assemblyWorker = null;
	}
	return assemblyWorker;
}

export function requestAssembly(
	worker: Worker,
	input: unknown,
	transfer: Transferable[]
): Promise<AssembledGeometry[]> {
	return new Promise<AssembledGeometry[]>((resolve, reject) => {
		const id = nextAssemblyRequestId++;
		pendingAssemblies.set(id, { resolve, reject });
		worker.postMessage({ id, input }, transfer);
	});
}
