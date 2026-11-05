import { describe, expect, it, vi } from 'vitest';
import type { ILogger, RequestContext, SolveMetric } from '@selvajs/platform';
import { SupabaseSolveMetricSink } from '../SupabaseSolveMetricSink.js';
import type { ClientBundle } from '../client.js';

const ctx = { userId: 'u' } as unknown as RequestContext;
const metric = { definitionUrl: 'd', channel: 'live', durationMs: 1, ok: true } as SolveMetric;

describe('SupabaseSolveMetricSink under a stalled backend', () => {
	it('holds the cap across rows waiting to be written, and says it dropped them', async () => {
		const insert = vi.fn(() => new Promise(() => {}));
		const bundle = { serviceClient: { from: () => ({ insert }) } } as unknown as ClientBundle;
		const error = vi.fn();
		const sink = new SupabaseSolveMetricSink(bundle, {
			maxBatchSize: 10,
			maxBufferSize: 50,
			logger: { error } as unknown as ILogger
		});

		for (let i = 0; i < 1000; i++) await sink.record(ctx, metric);

		expect(sink.pendingRows).toBeLessThanOrEqual(50);
		const dropped = error.mock.calls.reduce((n, call) => n + (call[1].dropped as number), 0);
		expect(dropped).toBeGreaterThanOrEqual(1000 - 50 - 10);
	});

	it('writes everything when the backend keeps up', async () => {
		const inserted: unknown[][] = [];
		const insert = vi.fn(async (rows: unknown[]) => {
			inserted.push(rows);
			return { error: null };
		});
		const bundle = { serviceClient: { from: () => ({ insert }) } } as unknown as ClientBundle;
		const sink = new SupabaseSolveMetricSink(bundle, { maxBatchSize: 2 });

		for (let i = 0; i < 5; i++) await sink.record(ctx, metric);
		await sink.close();

		expect(inserted.flat()).toHaveLength(5);
		expect(sink.pendingRows).toBe(0);
	});
});
