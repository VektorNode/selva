// WebSocket SolveDriver: the transport adapter that drives a preview Solve Session over the
// Grasshopper socket. It satisfies @selvajs/ui's SolveDriver — solve() sends values, and as
// the `outputs` envelope plus its trailing binary mesh frames arrive, it parses them and
// reports {outputs, meshes} back through the session's reporter.
//
// Every WebSocket solve quirk lives here and nowhere else: value preparation (stripping file
// metadata GH already has), the monotonic-token mesh-blob streaming (so a stale initialData
// parse can't clobber live outputs), the early/late binary-frame ring buffer, and the
// in-flight `isSolving` mirror. The Solve Session never learns any of it.

import type { WebSocketState, WsOutputsMessage } from '$lib/websocket/websocket.svelte';
import type { SolveReporter } from '@selvajs/ui';
import type { PreviewSolveDriver } from './schema-source';
import {
	parseDisplayItems,
	parseMeshBatchBlob,
	SCALE_FACTORS
} from '@selvajs/compute/visualization';
import type { DisplayItem } from '@selvajs/compute/visualization';
import type { RhinoModule } from 'rhino3dm';
import type * as THREE from 'three';

// rhino3dm ships its WASM as a sibling `.wasm` the JS loader fetches at runtime. By default it
// requests `/rhino3dm.wasm` (relative to the page), which SvelteKit doesn't serve → 404. Import the
// file as a Vite URL asset instead: Vite emits it to a real served URL (dev and build) and we hand
// that to rhino3dm via `locateFile`. No manual static/ copy, and it survives version bumps.
import rhinoWasmUrl from 'rhino3dm/rhino3dm.wasm?url';

// rhino3dm is a heavy WASM module needed only to decode curve display items. Load it once, lazily,
// the first time a solve actually carries curves — and share the promise across solves. Points and
// meshes need nothing; curves are skipped (with a warning) until it resolves on a later solve.
let rhinoPromise: Promise<RhinoModule> | null = null;
function getRhino(): Promise<RhinoModule> {
	if (!rhinoPromise) {
		rhinoPromise = import('rhino3dm').then((m) => {
			// rhino3dm's published types declare `default()` with no args, but the underlying
			// Emscripten module accepts `{ locateFile }` at runtime. Cast over the type gap.
			const init = m.default as (opts?: {
				locateFile?: (path: string) => string;
			}) => Promise<RhinoModule>;
			return init({ locateFile: () => rhinoWasmUrl });
		});
	}
	return rhinoPromise;
}

/** Strip file metadata objects — Grasshopper already has the file. */
function prepareValuesForSend(values: Record<string, unknown>): Record<string, unknown> {
	const prepared: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(values)) {
		let parsed = value;
		if (typeof value === 'string' && value.trim().startsWith('{')) {
			try {
				parsed = JSON.parse(value);
			} catch {
				/* keep as string */
			}
		}
		if (
			parsed &&
			typeof parsed === 'object' &&
			'_isMetadata' in parsed &&
			(parsed as Record<string, unknown>)._isMetadata === true
		)
			continue;
		prepared[key] = value;
	}
	return prepared;
}

export function createWebSocketSolveDriver(
	wsState: WebSocketState,
	sessionId: string,
	getReporter: () => SolveReporter
): PreviewSolveDriver {
	let modelUnits = 'Meters';

	// Monotonic token: each outputs message grabs a fresh value and only commits its parsed
	// meshes if no newer message has started since. Prevents a stale parse from clobbering
	// live outputs.
	let outputsToken = 0;

	// Binary mesh frames arrive as separate WS messages after the JSON `outputs` envelope.
	// The envelope says how many blobs to expect (binaryBatchCount); we collect that many
	// ArrayBuffers then parse together. A small ring buffer handles frames that arrive before
	// their envelope reached this handler.
	const pendingBlobs: ArrayBuffer[] = [];
	let pendingExpectation: {
		token: number;
		expected: number;
		scaleFactor: number;
		resolve: (blobs: ArrayBuffer[]) => void;
	} | null = null;

	function collectPendingBlobs(token: number, expected: number): Promise<ArrayBuffer[]> {
		const drained = pendingBlobs.splice(0, pendingBlobs.length);
		if (drained.length >= expected) {
			return Promise.resolve(drained.slice(0, expected));
		}
		return new Promise((resolve) => {
			pendingExpectation = {
				token,
				expected,
				scaleFactor: SCALE_FACTORS[modelUnits as keyof typeof SCALE_FACTORS] ?? 1,
				resolve
			};
			pendingBlobs.push(...drained);
		});
	}

	function handleBinaryFrame(buffer: ArrayBuffer) {
		// No active expectation: a frame arrived ahead of (or after) its envelope. Buffer it;
		// the next outputs message drains on entry. Cap to avoid unbounded growth.
		if (!pendingExpectation) {
			if (pendingBlobs.length < 64) pendingBlobs.push(buffer);
			return;
		}
		// Stale frame (its expectation was superseded by a newer outputs message). Drop.
		if (pendingExpectation.token !== outputsToken) {
			pendingExpectation = null;
			pendingBlobs.length = 0;
			return;
		}
		pendingBlobs.push(buffer);
		if (pendingBlobs.length >= pendingExpectation.expected) {
			const expectation = pendingExpectation;
			const blobs = pendingBlobs.splice(0, expectation.expected);
			pendingExpectation = null;
			expectation.resolve(blobs);
		}
	}

	async function handleOutputs(message: WsOutputsMessage) {
		if (message.sessionId !== sessionId) return;

		const myToken = ++outputsToken;
		if (message.modelUnits) modelUnits = message.modelUnits;

		const scaleFactor = SCALE_FACTORS[modelUnits as keyof typeof SCALE_FACTORS] ?? 1;

		// The scene array combines meshes (binary frames) and non-mesh items (curves/points JSON).
		// `undefined` means "no display payload at all — leave the existing scene alone." An empty
		// array means "clear the scene." So we only leave it undefined when the solve carries neither
		// a binaryBatchCount nor any displayItems.
		const hasDisplayItems = Array.isArray(message.displayItems) && message.displayItems.length > 0;
		const hasMeshTransport = typeof message.binaryBatchCount === 'number';

		let sceneObjects: THREE.Object3D[] | undefined;

		// `binaryBatchCount`: `0` clears meshes, `>0` collects+parses that many frames, `undefined`
		// means no mesh payload this solve.
		if (hasMeshTransport) {
			const expected = message.binaryBatchCount as number;
			if (expected === 0) {
				if (myToken === outputsToken) sceneObjects = [];
			} else {
				try {
					const blobs = await collectPendingBlobs(myToken, expected);
					if (myToken === outputsToken) {
						const all: THREE.Object3D[] = [];
						for (const blob of blobs) {
							const parsed = await parseMeshBatchBlob(blob, {
								mergeByMaterial: false,
								applyTransforms: true,
								scaleFactor,
								debug: false
							});
							all.push(...parsed);
						}
						if (myToken === outputsToken) sceneObjects = all;
					}
				} catch (err) {
					console.error('[Preview] Error parsing display data:', err);
				}
			}
		}

		// Non-mesh display items ride the JSON envelope. Curves need rhino3dm (lazy-loaded); points
		// don't. Tessellated objects get the same unit scale the mesh blobs received, so items and
		// meshes share one frame.
		if (hasDisplayItems) {
			try {
				const items = message.displayItems as DisplayItem[];
				const needsRhino = items.some((it) => it.kind === 'curve');
				const rhino = needsRhino ? await getRhino() : undefined;

				if (myToken === outputsToken) {
					const objects = parseDisplayItems(items, { rhino, applyTransforms: true });
					if (scaleFactor !== 1) {
						for (const obj of objects) obj.scale.set(scaleFactor, scaleFactor, scaleFactor);
					}
					// Start the array if the mesh path didn't (items-only solve).
					sceneObjects = [...(sceneObjects ?? []), ...objects];
				}
			} catch (err) {
				console.error('[Preview] Error parsing display items:', err);
			}
		}

		// Report raw outputs + fileOutputs; the preview reporter filters to schema outputs. If
		// our token was superseded mid-parse, skip the report so we don't apply stale display.
		if (myToken !== outputsToken) return;

		console.info('[Preview] parsed scene objects', sceneObjects);

		getReporter().report({
			outputs: { ...(message.outputs ?? {}), ...(message.fileOutputs ?? {}) },
			...(sceneObjects !== undefined ? { meshes: sceneObjects } : {})
		});
	}

	wsState.on('outputs', handleOutputs);
	wsState.on('binaryFrame', handleBinaryFrame);

	return {
		solve(values) {
			if (!wsState.connected) {
				console.warn('[Preview] Cannot send values - WebSocket not connected');
				return;
			}
			wsState.sendValueUpdate(sessionId, prepareValuesForSend(values));
		},
		cancel() {
			// The WS transport has no per-solve cancel; the latest values simply win. Nothing to
			// abort client-side.
		},
		get isSolving() {
			return wsState.isSolving;
		},
		primeFromInitialData(message) {
			// Same parse-and-report path as a live frame; initialData carries the same
			// outputs/binaryBatchCount/modelUnits fields.
			void handleOutputs(message);
		},
		dispose() {
			wsState.off('outputs', handleOutputs);
			wsState.off('binaryFrame', handleBinaryFrame);
			pendingExpectation = null;
			pendingBlobs.length = 0;
		}
	};
}
