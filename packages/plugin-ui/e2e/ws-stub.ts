// Minimal Grasshopper WebSocket stub for E2E. Speaks just enough of the C# protocol
// (messageSchemas.ts is the wire contract) to drive /builder and /preview without a live
// Rhino+Grasshopper. The app runs UNMODIFIED through its GrasshopperSource — this is a true
// transport-level fake, not a FakeSource swap.
//
// Handled inbound: requestInitialData -> initialData; saveSchema -> schemaUpdated +
// schemaSaved; valueUpdate -> outputs (echoes a trivial computed value). Everything else is
// ignored. No binary mesh frames (binaryBatchCount omitted = "leave meshes alone").

import { WebSocketServer, type WebSocket } from 'ws';

export const STUB_PORT = 8765;

// A minimal but valid UISchema: one number input placed in one tab/group, one output. Layout
// defaults are filled by the app, but we provide a tab so the builder shows a real editor and
// the preview renders an input control.
function sampleSchema() {
	return {
		id: 'e2e-schema',
		name: 'E2E Test Schema',
		documentId: 'e2e-doc',
		instanceSolve: true,
		inputs: [
			{
				id: 'in-count',
				nickname: 'Count',
				paramType: 'number',
				default: 3,
				minimum: 0,
				maximum: 10
			}
		],
		outputs: [{ id: 'out-area', nickname: 'Area', paramType: 'number' }],
		layout: {
			type: 'tabbed',
			gap: 16,
			tabs: [
				{
					id: 'tab-1',
					label: 'Main',
					groups: [
						{
							id: 'group-1',
							label: 'Inputs',
							order: 0,
							items: [
								{
									id: 'item-1',
									type: 'input',
									paramId: 'in-count',
									displayName: 'Count',
									widgetType: 'number',
									config: { minimum: 0, maximum: 10, stepSize: 1 }
								}
							]
						}
					]
				}
			]
		}
	};
}

function availableParams() {
	return {
		inputs: [
			{
				id: 'in-count',
				nickname: 'Count',
				paramType: 'number',
				default: 3,
				minimum: 0,
				maximum: 10
			}
		],
		outputs: [{ id: 'out-area', nickname: 'Area', paramType: 'number' }]
	};
}

function send(ws: WebSocket, message: Record<string, unknown>) {
	ws.send(JSON.stringify(message));
}

export function startStub(port = STUB_PORT): WebSocketServer {
	const wss = new WebSocketServer({ port });

	wss.on('connection', (ws) => {
		ws.on('message', (raw) => {
			let msg: { type?: string; sessionId?: string; values?: Record<string, unknown> };
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				return;
			}
			const sessionId = msg.sessionId ?? '';

			switch (msg.type) {
				case 'requestInitialData':
					send(ws, {
						type: 'initialData',
						sessionId,
						schema: sampleSchema(),
						schemaHash: 'hash-1',
						availableParams: availableParams(),
						currentValues: { 'in-count': 3 },
						isSolving: false
					});
					break;

				case 'saveSchema':
					// Echo the saved schema back as the canonical broadcast, then ack.
					send(ws, {
						type: 'schemaUpdated',
						sessionId,
						schema: sampleSchema(),
						schemaHash: 'hash-2'
					});
					send(ws, { type: 'schemaSaved', sessionId, success: true });
					break;

				case 'valueUpdate':
					// Trivial "solve": area = count * count. No display payload (no meshes).
					{
						const count = Number(msg.values?.['in-count'] ?? 0);
						send(ws, {
							type: 'outputs',
							sessionId,
							outputs: { 'out-area': count * count },
							modelUnits: 'Meters'
						});
					}
					break;

				default:
					// requestCurrentValues, requestSyncPreview, applySyncChanges, etc. — ignored.
					break;
			}
		});
	});

	return wss;
}

// Allow `node ws-stub.ts` (via tsx) as a standalone process for the Playwright webServer.
if (import.meta.url === `file://${process.argv[1]}`) {
	startStub();
	// eslint-disable-next-line no-console
	console.log(`[ws-stub] listening on ws://localhost:${STUB_PORT}`);
}
