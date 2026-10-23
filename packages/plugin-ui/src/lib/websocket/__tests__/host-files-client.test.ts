import { describe, expect, it } from 'vitest';
import { decodeHostFrame } from '../host-frame';
import { createHostFilesClient, HostFileError, type HostFileSocket } from '../host-files-client';

type Sent = { type: string; data: Record<string, unknown> };

/** Records what the client sends and lets a test play the plugin's replies. */
function fakeSocket() {
	const handlers = new Map<string, (data: unknown) => void>();
	const sent: Sent[] = [];
	const binary: Blob[] = [];
	const socket = {
		connected: true,
		send: (type: string, data: Record<string, unknown>) => sent.push({ type, data }),
		sendBinary: (data: Blob) => binary.push(data),
		on: (type: string, handler: (data: unknown) => void) => handlers.set(type, handler)
	};
	const reply = (type: string, message: Record<string, unknown>) =>
		handlers.get(type)?.({ type, sessionId: 's', ...message });
	return { socket: socket satisfies HostFileSocket, sent, binary, reply };
}

const client = (fake: ReturnType<typeof fakeSocket>, maxFileBytes = 1024) =>
	createHostFilesClient(fake.socket, () => 's', maxFileBytes);

// Lets the client's request() run up to its send before the test replies.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('host files client', () => {
	it('sends a save as one host frame and resolves true when saved', async () => {
		const fake = fakeSocket();
		const saving = client(fake).saveBlob(new Blob(['abc']), 'facade.zip');
		await tick();

		const frame = decodeHostFrame(await fake.binary[0].arrayBuffer());
		expect(frame?.header).toEqual({
			type: 'hostSaveFile',
			sessionId: 's',
			requestId: '1',
			fileName: 'facade.zip'
		});
		expect(new TextDecoder().decode(frame!.body)).toBe('abc');

		fake.reply('hostSaveFileResult', { requestId: '1', outcome: 'saved' });
		expect(await saving).toBe(true);
	});

	it('resolves false when the user cancels the Save dialog', async () => {
		const fake = fakeSocket();
		const saving = client(fake).saveBlob(new Blob(['abc']), 'facade.zip');
		await tick();

		fake.reply('hostSaveFileResult', { requestId: '1', outcome: 'cancelled' });
		expect(await saving).toBe(false);
	});

	it("throws the plugin's reason when the save failed", async () => {
		const fake = fakeSocket();
		const saving = client(fake).saveBlob(new Blob(['abc']), 'facade.zip');
		await tick();

		fake.reply('hostSaveFileResult', { requestId: '1', outcome: 'failed', error: 'Disk full.' });
		await expect(saving).rejects.toThrow(new HostFileError('Disk full.'));
	});

	// A frame over the plugin's cap would close the socket instead of failing the save.
	it('refuses a file over the limit without sending it', async () => {
		const fake = fakeSocket();

		await expect(client(fake, 2).saveBlob(new Blob(['abc']), 'big.zip')).rejects.toBeInstanceOf(
			HostFileError
		);
		expect(fake.binary).toEqual([]);
	});

	it('matches each reply to its own request', async () => {
		const fake = fakeSocket();
		const files = client(fake);
		const first = files.saveBlob(new Blob(['a']), 'a.zip');
		const second = files.pickFile({ accept: '.slvp' });
		await tick();

		fake.reply('hostPickFileResult', { requestId: '2', outcome: 'cancelled' });
		fake.reply('hostSaveFileResult', { requestId: '1', outcome: 'saved' });

		expect(await second).toBeNull();
		expect(await first).toBe(true);
	});

	it('asks for a pick with the accept list split, and builds a File from the reply', async () => {
		const fake = fakeSocket();
		const picking = client(fake).pickFile({ accept: '.slvp, .sps' });
		await tick();

		expect(fake.sent).toEqual([
			{
				type: 'hostPickFile',
				data: { sessionId: 's', requestId: '1', accept: ['.slvp', '.sps'] }
			}
		]);

		fake.reply('hostPickedFile', {
			requestId: '1',
			name: 'preset.slvp',
			body: new TextEncoder().encode('{}').buffer
		});
		const file = await picking;
		expect(file?.name).toBe('preset.slvp');
		expect(await file?.text()).toBe('{}');
	});

	it('rejects requests in flight when the socket closes', async () => {
		const fake = fakeSocket();
		const picking = client(fake).pickFile({ accept: '*' });
		await tick();

		fake.reply('socketClosed', {});
		await expect(picking).rejects.toBeInstanceOf(HostFileError);
	});

	it('refuses to ask while disconnected', async () => {
		const fake = fakeSocket();
		fake.socket.connected = false;

		await expect(client(fake).pickFile({ accept: '*' })).rejects.toBeInstanceOf(HostFileError);
		expect(fake.sent).toEqual([]);
	});
});
