import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WEBSOCKET_MAX_RECONNECT_ATTEMPTS, WEBSOCKET_RECONNECT_INTERVAL } from '#lib/app.config.js';
import { BRIDGE_UNAUTHORIZED_CLOSE_CODE } from '../bridge-handshake';
import { WebSocketState } from '../websocket.svelte';

/** Stands in for the browser's WebSocket; the test plays the plugin's side by hand. */
class FakeSocket {
	static readonly OPEN = 1;
	static instances: FakeSocket[] = [];

	readyState = 0;
	binaryType = 'blob';
	sent: Record<string, unknown>[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	onclose: ((event: { code: number }) => void) | null = null;

	constructor(readonly url: string) {
		FakeSocket.instances.push(this);
	}

	send(data: string) {
		this.sent.push(JSON.parse(data));
	}

	close() {}

	open() {
		this.readyState = FakeSocket.OPEN;
		this.onopen?.();
	}

	receive(message: Record<string, unknown>) {
		this.onmessage?.({ data: JSON.stringify(message) });
	}

	/** Opens, then answers the secret the way the plugin does when it accepts it. */
	accept() {
		this.open();
		this.receive({ type: 'authenticated' });
	}

	closeFromServer(code = 1006) {
		this.readyState = 3;
		this.onclose?.({ code });
	}
}

const latest = () => FakeSocket.instances.at(-1)!;

function connectedState(): { ws: WebSocketState; connecting: Promise<boolean> } {
	const ws = new WebSocketState('ws://localhost:8765');
	ws.setAuthSecret('secret', false);
	return { ws, connecting: ws.connect() };
}

describe('WebSocketState', () => {
	beforeEach(() => {
		FakeSocket.instances = [];
		vi.useFakeTimers();
		vi.stubGlobal('WebSocket', FakeSocket);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	describe('authentication', () => {
		it('sends the secret first and connects once the plugin accepts it', async () => {
			const { ws, connecting } = connectedState();

			latest().open();
			expect(latest().sent).toEqual([{ type: 'authenticate', secret: 'secret' }]);
			expect(ws.connected).toBe(false);

			latest().receive({ type: 'authenticated', role: 'player' });

			await expect(connecting).resolves.toBe(true);
			expect(ws.connected).toBe(true);
			expect(ws.role).toBe('player');
		});

		it('gives up for good when the plugin refuses the secret', async () => {
			const { ws, connecting } = connectedState();

			latest().open();
			latest().closeFromServer(BRIDGE_UNAUTHORIZED_CLOSE_CODE);

			await expect(connecting).resolves.toBe(false);
			expect(ws.authRejected).toBe(true);
			// The secret belongs to another session: retrying would only be refused again.
			expect(vi.getTimerCount()).toBe(0);
			vi.advanceTimersByTime(60 * 60 * 1000);
			expect(FakeSocket.instances).toHaveLength(1);
			await expect(ws.connect()).resolves.toBe(false);
			expect(FakeSocket.instances).toHaveLength(1);
		});

		it('connects again once given a new secret', async () => {
			const { ws } = connectedState();
			latest().open();
			latest().closeFromServer(BRIDGE_UNAUTHORIZED_CLOSE_CODE);

			ws.setAuthSecret('fresh', false);
			const connecting = ws.connect();
			latest().open();
			expect(latest().sent[0]).toEqual({ type: 'authenticate', secret: 'fresh' });
			latest().receive({ type: 'authenticated' });

			await expect(connecting).resolves.toBe(true);
			expect(ws.authRejected).toBe(false);
		});
	});

	describe('reconnecting', () => {
		it('backs off exponentially and stops after the attempt limit', async () => {
			const { connecting } = connectedState();
			latest().accept();
			await connecting;

			latest().closeFromServer();
			for (let attempt = 1; attempt <= WEBSOCKET_MAX_RECONNECT_ATTEMPTS; attempt++) {
				const delay = WEBSOCKET_RECONNECT_INTERVAL * 2 ** (attempt - 1);
				vi.advanceTimersByTime(delay - 1);
				expect(FakeSocket.instances).toHaveLength(attempt);
				vi.advanceTimersByTime(1);
				expect(FakeSocket.instances).toHaveLength(attempt + 1);
				latest().closeFromServer();
			}

			vi.advanceTimersByTime(WEBSOCKET_RECONNECT_INTERVAL * 2 ** WEBSOCKET_MAX_RECONNECT_ATTEMPTS);
			expect(FakeSocket.instances).toHaveLength(WEBSOCKET_MAX_RECONNECT_ATTEMPTS + 1);
		});

		it('starts the backoff over after a reconnect succeeds', async () => {
			const { connecting } = connectedState();
			latest().accept();
			await connecting;

			latest().closeFromServer();
			vi.advanceTimersByTime(WEBSOCKET_RECONNECT_INTERVAL);
			latest().closeFromServer();
			vi.advanceTimersByTime(WEBSOCKET_RECONNECT_INTERVAL * 2);
			latest().accept();

			latest().closeFromServer();
			vi.advanceTimersByTime(WEBSOCKET_RECONNECT_INTERVAL);
			expect(FakeSocket.instances).toHaveLength(4);
		});

		it('asks for the session state again after reconnecting', async () => {
			const { ws, connecting } = connectedState();
			latest().accept();
			await connecting;
			ws.requestInitialData('s1');

			latest().closeFromServer();
			vi.advanceTimersByTime(WEBSOCKET_RECONNECT_INTERVAL);
			latest().accept();

			expect(latest().sent).toContainEqual({ type: 'requestInitialData', sessionId: 's1' });
		});

		it('does not reconnect after a deliberate disconnect', async () => {
			const { ws, connecting } = connectedState();
			latest().accept();
			await connecting;

			ws.disconnect();
			vi.advanceTimersByTime(WEBSOCKET_RECONNECT_INTERVAL * 4);

			expect(FakeSocket.instances).toHaveLength(1);
		});
	});

	describe('value updates', () => {
		it('batches updates within the window into one message', async () => {
			const { ws, connecting } = connectedState();
			latest().accept();
			await connecting;

			ws.sendValueUpdate('s1', { a: 1 });
			ws.sendValueUpdate('s1', { b: 2 });
			ws.sendValueUpdate('s1', { a: 3 });
			vi.advanceTimersByTime(50);

			const updates = latest().sent.filter((m) => m.type === 'valueUpdate');
			expect(updates).toEqual([{ type: 'valueUpdate', sessionId: 's1', values: { a: 3, b: 2 } }]);
		});

		it('holds the latest update while solving and sends it when the solve ends', async () => {
			const { ws, connecting } = connectedState();
			latest().accept();
			await connecting;
			latest().receive({ type: 'solvingState', sessionId: 's1', isSolving: true });

			ws.sendValueUpdate('s1', { a: 1 });
			ws.sendValueUpdate('s1', { a: 2 });
			vi.advanceTimersByTime(1000);
			expect(latest().sent.filter((m) => m.type === 'valueUpdate')).toEqual([]);

			latest().receive({ type: 'solvingState', sessionId: 's1', isSolving: false });

			expect(latest().sent.filter((m) => m.type === 'valueUpdate')).toEqual([
				{ type: 'valueUpdate', sessionId: 's1', values: { a: 2 } }
			]);
		});
	});
});
