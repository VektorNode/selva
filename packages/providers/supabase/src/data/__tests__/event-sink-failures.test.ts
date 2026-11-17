import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent, IEventSink, ILogger } from '@selvajs/platform';
import { SupabaseEventSink } from '../SupabaseEventSink.js';
import type { ClientBundle } from '../client.js';

const event: DomainEvent = {
	type: 'invite.created',
	inviteId: 'i',
	orgId: 'o',
	email: 'person@acme.test',
	actorId: 'a'
};

const bundleInserting = (insert: () => Promise<unknown>) =>
	({ serviceClient: { from: () => ({ insert }) } }) as unknown as ClientBundle;

describe('SupabaseEventSink.emit', () => {
	it.each([
		['rejected', async () => ({ error: { message: 'down' } })],
		['thrown', async () => Promise.reject(new Error('network'))]
	])('swallows a %s write and logs it without the payload', async (_kind, insert) => {
		const error = vi.fn();
		const sink = new SupabaseEventSink(bundleInserting(insert), {
			logger: { error } as unknown as ILogger
		});

		await expect(sink.emit(event)).resolves.toBeUndefined();

		expect(error).toHaveBeenCalledOnce();
		expect(JSON.stringify(error.mock.calls)).not.toContain('person@acme.test');
	});
});

describe('SupabaseEventSink with a host event union', () => {
	type HostEvent = { type: 'host.job_released'; jobId: string; actorId: string };

	it('writes a host event, and still serves as the Selva sink', async () => {
		const insert = vi.fn(async () => ({ error: null }));
		const sink = new SupabaseEventSink<DomainEvent | HostEvent>(bundleInserting(insert));
		const selvaSink: IEventSink = sink;

		await sink.emit({ type: 'host.job_released', jobId: 'j', actorId: 'a' });
		await selvaSink.emit(event);

		expect(insert.mock.calls.map((call) => (call as unknown[])[0])).toMatchObject([
			{ type: 'host.job_released', actor_id: 'a' },
			{ type: 'invite.created', actor_id: 'a' }
		]);
	});
});
