import { describe, it, expect } from 'vitest';
import { createSolveEventBus } from '../bus.server';
import { closeAllSolveEventStreams, openSolveEventStream } from '../sse.server';

async function readToEnd(response: Response): Promise<string> {
	return new Response(response.body).text();
}

describe('closeAllSolveEventStreams', () => {
	it('ends open streams and frees their stream ids', async () => {
		const bus = createSolveEventBus();
		const open = (streamId: string) =>
			openSolveEventStream({
				bus,
				streamId,
				ownerKey: 'user:a',
				signal: new AbortController().signal
			});
		const a = open('s1')!;
		const b = open('s2')!;

		closeAllSolveEventStreams();

		expect(await readToEnd(a)).toContain('event: ready');
		expect(await readToEnd(b)).toContain('event: ready');
		// Unsubscribed, so another owner may claim the id again.
		expect(bus.openStream('s1', 'user:b', () => {})).not.toBeNull();
	});
});
