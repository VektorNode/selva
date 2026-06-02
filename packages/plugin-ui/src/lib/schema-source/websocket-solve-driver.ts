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
import { parseMeshBatchBlob, SCALE_FACTORS } from '@selvajs/compute/visualization';
import type * as THREE from 'three';

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

		let meshes: THREE.Mesh[] | undefined;

		// `binaryBatchCount` describes the binary mesh transport. `0` means "no display this
		// solve, clear the meshes." `undefined` means no display payload at all — leave meshes
		// alone (report outputs only). A number > 0 means collect+parse that many frames.
		if (typeof message.binaryBatchCount === 'number') {
			const expected = message.binaryBatchCount;
			const scaleFactor = SCALE_FACTORS[modelUnits as keyof typeof SCALE_FACTORS] ?? 1;

			if (expected === 0) {
				if (myToken === outputsToken) meshes = [];
			} else {
				try {
					const blobs = await collectPendingBlobs(myToken, expected);
					if (myToken === outputsToken) {
						const all: THREE.Mesh[] = [];
						for (const blob of blobs) {
							const parsed = await parseMeshBatchBlob(blob, {
								mergeByMaterial: false,
								applyTransforms: true,
								scaleFactor,
								debug: false
							});
							all.push(...parsed);
						}
						if (myToken === outputsToken) meshes = all;
					}
				} catch (err) {
					console.error('[Preview] Error parsing display data:', err);
				}
			}
		}

		// Report raw outputs + fileOutputs; the preview reporter filters to schema outputs. If
		// our token was superseded mid-parse, skip the report so we don't apply stale display.
		if (myToken !== outputsToken) return;

		getReporter().report({
			outputs: { ...(message.outputs ?? {}), ...(message.fileOutputs ?? {}) },
			...(meshes !== undefined ? { meshes } : {})
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
