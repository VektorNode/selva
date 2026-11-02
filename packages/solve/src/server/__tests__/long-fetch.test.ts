import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { fetchForDeadline } from '../long-fetch';

describe('fetchForDeadline', () => {
	let server: Server;
	let url: string;

	beforeAll(async () => {
		server = createServer((_req, res) => res.end('{"ok":true}'));
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
	});

	afterAll(() => new Promise((resolve) => server.close(resolve)));

	it('leaves a deadline under undici limits on the global fetch', () => {
		expect(fetchForDeadline(299_999)).toBeUndefined();
	});

	it('gives a deadline that reaches them a fetch that answers like the global one', async () => {
		const send = fetchForDeadline(300_000);
		const response = await send!(url, { method: 'POST', body: '{}' });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	// `getIO` passes no signal, so nothing else would bound a hung server on a page load.
	it('keeps a ceiling on a call with no signal of its own', async () => {
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		await fetchForDeadline(300_000)!(url);
		expect(timeout).toHaveBeenCalledWith(300_000);
		timeout.mockRestore();
	});

	it('adds no ceiling to a call that has a signal: the solve deadline stays the only one', async () => {
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		const { signal } = new AbortController();
		await fetchForDeadline(300_000)!(url, { signal });
		expect(timeout).not.toHaveBeenCalled();
		timeout.mockRestore();
	});
});
