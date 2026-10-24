import { describe, expect, it } from 'vitest';
import { createGeometryPicksClient, type GeometryPickSocket } from '../geometry-picks-client';

function fakeSocket() {
	const handlers = new Map<string, (data: unknown) => void>();
	const sent: Array<{ type: string; data: Record<string, unknown> }> = [];
	const socket: GeometryPickSocket & {
		emit: (type: string, data: unknown) => void;
		sent: typeof sent;
	} = {
		connected: true,
		send: (type, data) => sent.push({ type, data }),
		on: (type, handler) => handlers.set(type, handler),
		emit: (type, data) => handlers.get(type)?.(data),
		sent
	};
	return socket;
}

describe('geometry picks client', () => {
	it('resolves a pick with the summary the plugin sends back', async () => {
		const socket = fakeSocket();
		const client = createGeometryPicksClient(socket, () => 's1');

		const result = client.pickGeometry('param-1');
		const request = socket.sent[0];
		expect(request).toMatchObject({
			type: 'pickGeometry',
			data: { sessionId: 's1', paramId: 'param-1' }
		});

		socket.emit('pickGeometryResult', {
			requestId: request.data.requestId,
			outcome: 'picked',
			summary: '2 curves'
		});
		await expect(result).resolves.toEqual({ outcome: 'picked', summary: '2 curves' });
	});

	it('ignores a reply to another page', async () => {
		const socket = fakeSocket();
		const client = createGeometryPicksClient(socket, () => 's1');

		const result = client.pickGeometry('param-1');
		socket.emit('pickGeometryResult', { requestId: 'other', outcome: 'picked', summary: 'x' });
		socket.emit('pickGeometryResult', {
			requestId: socket.sent[0].data.requestId,
			outcome: 'cancelled'
		});

		await expect(result).resolves.toEqual({ outcome: 'cancelled' });
	});

	it('reports a pick in flight until its reply arrives', () => {
		const socket = fakeSocket();
		const client = createGeometryPicksClient(socket, () => 's1');

		expect(client.picking).toBe(false);
		client.pickGeometry('param-1');
		expect(client.picking).toBe(true);
		socket.emit('pickGeometryResult', {
			requestId: socket.sent[0].data.requestId,
			outcome: 'cancelled'
		});
		expect(client.picking).toBe(false);
	});

	it('gives each pick a requestId another page cannot reuse', () => {
		const panel = fakeSocket();
		const tab = fakeSocket();
		createGeometryPicksClient(panel, () => 's1').pickGeometry('param-1');
		createGeometryPicksClient(tab, () => 's1').pickGeometry('param-2');

		expect(panel.sent[0].data.requestId).not.toEqual(tab.sent[0].data.requestId);
	});

	it('fails a pick in flight when the socket closes', async () => {
		const socket = fakeSocket();
		const client = createGeometryPicksClient(socket, () => 's1');

		const result = client.pickGeometry('param-1');
		socket.emit('socketClosed', undefined);

		await expect(result).resolves.toMatchObject({ outcome: 'failed' });
	});
});
