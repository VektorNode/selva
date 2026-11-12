import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AppExportError,
	createAppExportClient,
	EXPORT_TIMEOUT_MS,
	type AppExportSocket
} from '../app-export-client';

type Sent = { type: string; data: Record<string, unknown> };

/** Records what the client sends and lets a test play the plugin's replies. */
function fakeSocket() {
	const handlers = new Map<string, (data: unknown) => void>();
	const sent: Sent[] = [];
	const socket = {
		connected: true,
		send: (type: string, data: Record<string, unknown>) => sent.push({ type, data }),
		on: (type: string, handler: (data: unknown) => void) => handlers.set(type, handler)
	};
	const reply = (type: string, message: Record<string, unknown>) =>
		handlers.get(type)?.({ type, sessionId: 's', ...message });
	return { socket: socket satisfies AppExportSocket, sent, reply };
}

const client = (fake: ReturnType<typeof fakeSocket>) =>
	createAppExportClient(fake.socket, () => 's');

describe('app export client', () => {
	// Sequential ids keep the replies below readable; uniqueness is pending-requests' to test.
	beforeEach(() => {
		let next = 0;
		vi.spyOn(crypto, 'randomUUID').mockImplementation(
			() => String(++next) as ReturnType<typeof crypto.randomUUID>
		);
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('asks with the name and key, and resolves with the file from the frame', async () => {
		const fake = fakeSocket();
		const exporting = client(fake).exportApp('Tower', 'correct horse');

		expect(fake.sent).toEqual([
			{
				type: 'exportApp',
				data: { sessionId: 's', requestId: '1', name: 'Tower', key: 'correct horse' }
			}
		]);

		fake.reply('exportedApp', { requestId: '1', body: new TextEncoder().encode('SLVX').buffer });
		expect(await (await exporting).text()).toBe('SLVX');
	});

	// The plugin refuses a key that isn't text, so "no key" must be an absent field.
	it('leaves the key out when there is none', async () => {
		const fake = fakeSocket();
		const exporting = client(fake).exportApp('Tower', '');

		expect(fake.sent[0].data).toEqual({ sessionId: 's', requestId: '1', name: 'Tower' });

		fake.reply('exportAppFailed', { requestId: '1' });
		await expect(exporting).rejects.toThrow('Could not export the app.');
	});

	it("throws the plugin's reason when it sent no file", async () => {
		const fake = fakeSocket();
		const exporting = client(fake).exportApp('Tower', '');

		fake.reply('exportAppFailed', { requestId: '1', error: 'Save a schema first.' });
		await expect(exporting).rejects.toThrow(new AppExportError('Save a schema first.'));
	});

	it('matches each reply to its own request', async () => {
		const fake = fakeSocket();
		const exports = client(fake);
		const first = exports.exportApp('A', '');
		const second = exports.exportApp('B', '');

		fake.reply('exportedApp', { requestId: '2', body: new TextEncoder().encode('b').buffer });
		fake.reply('exportedApp', { requestId: '1', body: new TextEncoder().encode('a').buffer });

		expect(await (await first).text()).toBe('a');
		expect(await (await second).text()).toBe('b');
	});

	it('gives up when the plugin never answers', async () => {
		vi.useFakeTimers();
		const fake = fakeSocket();
		const exporting = client(fake).exportApp('Tower', '');
		const failed = expect(exporting).rejects.toBeInstanceOf(AppExportError);

		await vi.advanceTimersByTimeAsync(EXPORT_TIMEOUT_MS);
		await failed;
	});

	it('rejects a request in flight when the socket closes', async () => {
		const fake = fakeSocket();
		const exporting = client(fake).exportApp('Tower', '');

		fake.reply('socketClosed', {});
		await expect(exporting).rejects.toBeInstanceOf(AppExportError);
	});

	it('refuses to ask while disconnected', async () => {
		const fake = fakeSocket();
		fake.socket.connected = false;

		await expect(client(fake).exportApp('Tower', '')).rejects.toBeInstanceOf(AppExportError);
		expect(fake.sent).toEqual([]);
	});
});
