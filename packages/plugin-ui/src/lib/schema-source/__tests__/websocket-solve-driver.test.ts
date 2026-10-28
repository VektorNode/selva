import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseMeshBatchBlob = vi.hoisted(() => vi.fn());

vi.mock('@selvajs/visualization/parse', () => ({
	parseMeshBatchBlob,
	parseDisplayItems: () => [],
	SCALE_FACTORS: {}
}));
vi.mock('@selvajs/ui', () => ({
	decodeOutcome: () => undefined,
	finalizeResult: (result: unknown) => result
}));

import { createWebSocketSolveDriver } from '../websocket-solve-driver';

type Handler = (message: never) => unknown;

function fakeSocket() {
	const handlers = new Map<string, Handler>();
	return {
		handlers,
		wsState: {
			on: (name: string, handler: Handler) => handlers.set(name, handler),
			off: () => {},
			connected: true
		},
		outputs: (binaryBatchCount: number) =>
			handlers.get('outputs')!({ type: 'outputs', sessionId: 's', binaryBatchCount } as never),
		frame: (buffer: ArrayBuffer) => handlers.get('binaryFrame')!(buffer as never)
	};
}

beforeEach(() => parseMeshBatchBlob.mockReset());

describe('createWebSocketSolveDriver', () => {
	it('skips the frames of a solve that a newer one has replaced', async () => {
		const socket = fakeSocket();
		const reports: { meshes?: unknown[] }[] = [];
		createWebSocketSolveDriver(socket.wsState as never, 's', () => ({
			report: (result: { meshes?: unknown[] }) => reports.push(result),
			reportError: () => {},
			reportAborted: () => {}
		}));

		let finishFirst!: (meshes: unknown[]) => void;
		parseMeshBatchBlob.mockImplementationOnce(
			() => new Promise((resolve) => (finishFirst = resolve))
		);

		const stale = socket.outputs(2);
		socket.frame(new ArrayBuffer(1));
		socket.frame(new ArrayBuffer(1));
		await vi.waitFor(() => expect(parseMeshBatchBlob).toHaveBeenCalledTimes(1));

		const newer = socket.outputs(0);
		finishFirst([]);
		await Promise.all([stale, newer]);

		expect(parseMeshBatchBlob).toHaveBeenCalledTimes(1);
		expect(reports).toHaveLength(1);
		expect(reports[0]!.meshes).toEqual([]);
	});
});
