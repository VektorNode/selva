import { describe, expect, it } from 'vitest';
import { createPendingRequests } from '../pending-requests';

type Reply = { requestId: string; value: string };

function fakeSocket() {
	const handlers = new Map<string, (data: unknown) => void>();
	return {
		on: (type: string, handler: (data: unknown) => void) => handlers.set(type, handler),
		emit: (type: string, data: unknown) => handlers.get(type)?.(data)
	};
}

function setup(onReply?: (reply: Reply) => void) {
	const socket = fakeSocket();
	const pending = createPendingRequests<Reply>(socket, {
		replyTypes: ['a', 'b'],
		connectionLost: () => new Error('lost'),
		onReply
	});
	const ids: string[] = [];
	const ask = () => pending.request((id) => ids.push(id));
	return { socket, pending, ids, ask };
}

describe('pending requests', () => {
	it('settles each request with its own reply, on any reply type', async () => {
		const { socket, ids, ask } = setup();
		const first = ask();
		const second = ask();

		socket.emit('b', { requestId: ids[1], value: 'two' });
		socket.emit('a', { requestId: ids[0], value: 'one' });

		await expect(first).resolves.toMatchObject({ value: 'one' });
		await expect(second).resolves.toMatchObject({ value: 'two' });
	});

	it('gives every request a fresh UUID', () => {
		const { ids, ask } = setup();
		ask();
		ask();

		expect(ids[0]).not.toEqual(ids[1]);
		expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('ignores a reply to another page but still reports it', () => {
		const seen: Reply[] = [];
		const { socket, pending, ask } = setup((reply) => seen.push(reply));
		ask();

		socket.emit('a', { requestId: 'other', value: 'x' });

		expect(pending.size).toBe(1);
		expect(seen).toEqual([{ requestId: 'other', value: 'x' }]);
	});

	it('rejects every request in flight when the socket closes', async () => {
		const { socket, pending, ask } = setup();
		const first = ask();
		const second = ask();

		socket.emit('socketClosed', undefined);

		await expect(first).rejects.toThrow('lost');
		await expect(second).rejects.toThrow('lost');
		expect(pending.size).toBe(0);
	});
});
