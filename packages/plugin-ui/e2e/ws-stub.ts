// Minimal Grasshopper WebSocket stub for E2E. Speaks just enough of the C# protocol
// (messageSchemas.ts is the wire contract) to drive /builder and /preview without a live
// Rhino+Grasshopper. The app runs unmodified through its GrasshopperSource — a true
// transport-level fake, not a FakeSource swap.
//
// The first message must be `authenticate` with STUB_SECRET, as the plugin requires.
// Handled inbound after that: requestInitialData -> initialData; saveSchema -> schemaUpdated
// (echoing the saved schema) + schemaSaved; valueUpdate -> outputs (echoes a trivial computed
// value); selvaGetAccount, selvaListTargets and selvaUpload -> the shared wire fixtures (signed
// in, a suggestion, a successful upload). Everything else is ignored. No binary mesh frames
// (binaryBatchCount omitted = "leave meshes alone").

import { readFileSync } from 'node:fs';
import { WebSocketServer, type WebSocket } from 'ws';

import { UI_SCHEMA_VERSION, type UISchema } from '@selvajs/schemas';

// Global setup binds a free port and publishes it as E2E_WS_PORT before the workers start; specs
// hand it to the page as wsPort. The fallback, for a standalone run, stays clear of the plugin's
// 8765 so a running Rhino never answers in the stub's place.
export const STUB_PORT = Number(process.env.E2E_WS_PORT ?? 8799);
export const STUB_SECRET = 'e2e-secret';

/** A Count the stub takes SLOW_SOLVE_MS to "solve", long enough for any solving indicator. */
export const SLOW_SOLVE_COUNT = 9;
const SLOW_SOLVE_MS = 2000;

const wireFixtures = new URL('../../schemas/fixtures/wire/', import.meta.url);

/** A shared wire fixture, re-addressed to the page's session. */
function fixture(name: string, sessionId: string): Record<string, unknown> {
	const message = JSON.parse(readFileSync(new URL(name, wireFixtures), 'utf-8'));
	return { ...message, sessionId };
}

// Discovered params, as Grasshopper reports them: a number and a value list.
const COUNT_PARAM = {
	id: 'in-count',
	nickname: 'Count',
	paramType: 'number',
	default: 3,
	minimum: 0,
	maximum: 10
} as const;
const TIMBER_PARAM = {
	id: 'in-timber',
	nickname: 'Timber',
	paramType: 'valueList',
	default: 'Oak',
	options: { Oak: '0', Larch: '1' }
} as const;

// A minimal but valid UISchema: the two params, the value list shown as buttons with icons,
// placed in one tab/group, and one output. Layout defaults are filled by the app, but a tab is
// provided so the builder shows a real editor and the preview renders input controls.
function sampleSchema(): UISchema {
	return {
		id: 'e2e-schema',
		schemaVersion: UI_SCHEMA_VERSION,
		name: 'E2E Test Schema',
		documentId: 'e2e-doc',
		instanceSolve: true,
		inputs: [
			{ id: 'in-count', nickname: 'Count', paramType: 'number', default: 3 },
			{ id: 'in-timber', nickname: 'Timber', paramType: 'valueList', default: 'Oak' }
		],
		outputs: [{ id: 'out-area', nickname: 'Area', type: 'number' }],
		assets: { a1b2c3d4e5f6: { d: 'M3 21V8l9-5 9 5v13' } },
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
								},
								{
									id: 'item-2',
									type: 'input',
									paramId: 'in-timber',
									displayName: 'Timber',
									widgetType: 'dropdown',
									config: {
										options: TIMBER_PARAM.options,
										displayAs: 'segmented',
										optionMedia: { Oak: { icon: 'a1b2c3d4e5f6' } }
									}
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
		inputs: [COUNT_PARAM, TIMBER_PARAM],
		outputs: [{ id: 'out-area', nickname: 'Area', paramType: 'number' }]
	};
}

function send(ws: WebSocket, message: Record<string, unknown>) {
	ws.send(JSON.stringify(message));
}

export function startStub(port = STUB_PORT): WebSocketServer {
	const wss = new WebSocketServer({ port });

	wss.on('connection', (ws) => {
		let authenticated = false;
		ws.on('message', (raw) => {
			let msg: {
				type?: string;
				sessionId?: string;
				secret?: string;
				values?: Record<string, unknown>;
				schema?: UISchema;
			};
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				return;
			}

			if (!authenticated) {
				if (msg.type !== 'authenticate' || msg.secret !== STUB_SECRET) {
					ws.close(4401, 'Unauthorized');
					return;
				}
				authenticated = true;
				send(ws, { type: 'authenticated' });
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
					// Echo what the page sent as the canonical broadcast, then ack, as the plugin does:
					// a save that drops part of the schema then shows up in the builder.
					send(ws, {
						type: 'schemaUpdated',
						sessionId,
						schema: msg.schema,
						schemaHash: 'hash-2'
					});
					send(ws, { type: 'schemaSaved', sessionId, success: true });
					break;

				case 'valueUpdate':
					// Trivial "solve": area = count * count. No display payload (no meshes). Framed
					// by solvingState in the plugin's order: true, outputs, false.
					{
						const count = Number(msg.values?.['in-count'] ?? 0);
						send(ws, { type: 'solvingState', sessionId, isSolving: true });
						setTimeout(
							() => {
								send(ws, {
									type: 'outputs',
									sessionId,
									outputs: { 'out-area': count * count },
									modelUnits: 'Meters'
								});
								send(ws, { type: 'solvingState', sessionId, isSolving: false });
							},
							count === SLOW_SOLVE_COUNT ? SLOW_SOLVE_MS : 0
						);
					}
					break;

				case 'selvaGetAccount':
					send(ws, fixture('selva-account.json', sessionId));
					break;

				case 'selvaListTargets':
					send(ws, fixture('selva-targets.json', sessionId));
					break;

				case 'selvaUpload':
					send(ws, fixture('selva-upload-progress.json', sessionId));
					send(ws, fixture('selva-upload-result.json', sessionId));
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
