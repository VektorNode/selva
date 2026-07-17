import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NoopLogger, type ILogger, type RequestContext, type SolveMetric } from '@selvajs/platform';
import { SupabaseSolveMetricSink } from '../SupabaseSolveMetricSink.js';
import type { ClientBundle } from '../client.js';

/**
 * Fake logger — the sink takes an injected `ILogger` (defaulting to
 * `NoopLogger`), so its diagnostics are captured by passing this in rather than
 * by spying on `console`.
 */
function fakeLogger(): ILogger & { error: ReturnType<typeof vi.fn> } {
	const logger = new NoopLogger() as ILogger & { error: ReturnType<typeof vi.fn> };
	logger.error = vi.fn();
	return logger;
}

/**
 * Batching behaviour, exercised against a fake client so these run without a
 * live Supabase stack. Persisted shape is covered by the conformance suite.
 */

type Insert = { rows: unknown[] };

function fakeBundle(opts: { fail?: boolean; hang?: () => Promise<void> } = {}) {
	const inserts: Insert[] = [];
	const bundle = {
		serviceClient: {
			from: (table: string) => {
				expect(table).toBe('solve_metrics');
				return {
					insert: async (rows: unknown[]) => {
						inserts.push({ rows });
						if (opts.hang) await opts.hang();
						return opts.fail ? { error: { message: 'boom' } } : { error: null };
					}
				};
			}
		}
	} as unknown as ClientBundle;
	return { bundle, inserts };
}

const ctx: RequestContext = {
	userId: 'user-1',
	platformPermissions: [],
	orgPermissions: [],
	system: true
};

function metric(overrides: Partial<SolveMetric> = {}): SolveMetric {
	return {
		definitionUrl: 'local:def',
		definitionId: 'def',
		versionId: 'v1',
		channel: 'live',
		orgId: 'org',
		durationMs: 10,
		ok: true,
		failureKind: 'ok',
		errorCount: 0,
		warningCount: 0,
		...overrides
	};
}

describe('SupabaseSolveMetricSink batching', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('does not write on record — it buffers', async () => {
		const { bundle, inserts } = fakeBundle();
		const sink = new SupabaseSolveMetricSink(bundle, { maxBatchSize: 5, flushIntervalMs: 1000 });

		await sink.record(ctx, metric());
		expect(inserts).toHaveLength(0);
	});

	it('writes one batch containing every buffered row once maxBatchSize is reached', async () => {
		const { bundle, inserts } = fakeBundle();
		const sink = new SupabaseSolveMetricSink(bundle, { maxBatchSize: 3, flushIntervalMs: 60_000 });

		await sink.record(ctx, metric({ durationMs: 1 }));
		await sink.record(ctx, metric({ durationMs: 2 }));
		await sink.record(ctx, metric({ durationMs: 3 }));
		await sink.flush();

		expect(inserts).toHaveLength(1);
		expect(inserts[0].rows).toHaveLength(3);
	});

	it('flushes a partial batch after the interval elapses', async () => {
		const { bundle, inserts } = fakeBundle();
		const sink = new SupabaseSolveMetricSink(bundle, { maxBatchSize: 100, flushIntervalMs: 2000 });

		await sink.record(ctx, metric());
		expect(inserts).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(2000);
		expect(inserts).toHaveLength(1);
		expect(inserts[0].rows).toHaveLength(1);
	});

	it('does not schedule a flush when the buffer is empty', async () => {
		const { bundle, inserts } = fakeBundle();
		const sink = new SupabaseSolveMetricSink(bundle, { flushIntervalMs: 1000 });

		await vi.advanceTimersByTimeAsync(5000);
		expect(inserts).toHaveLength(0);
		await sink.flush();
		expect(inserts).toHaveLength(0);
	});

	it('drops the oldest rows once the buffer cap is exceeded', async () => {
		const { bundle, inserts } = fakeBundle();
		const sink = new SupabaseSolveMetricSink(bundle, {
			maxBatchSize: 1000,
			maxBufferSize: 2,
			flushIntervalMs: 60_000,
			logger: fakeLogger()
		});

		await sink.record(ctx, metric({ durationMs: 1 }));
		await sink.record(ctx, metric({ durationMs: 2 }));
		await sink.record(ctx, metric({ durationMs: 3 }));
		await sink.flush();

		expect(inserts[0].rows).toEqual([
			expect.objectContaining({ duration_ms: 2 }),
			expect.objectContaining({ duration_ms: 3 })
		]);
	});

	it('serializes flushes so concurrent batches do not interleave', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const { bundle, inserts } = fakeBundle({ hang: () => gate });
		const sink = new SupabaseSolveMetricSink(bundle, {
			maxBatchSize: 100,
			flushIntervalMs: 60_000
		});

		await sink.record(ctx, metric({ durationMs: 1 }));
		const first = sink.flush();
		await sink.record(ctx, metric({ durationMs: 2 }));
		const second = sink.flush();

		// The second flush waits: no overlapping insert while the first is in flight.
		expect(inserts).toHaveLength(1);
		expect(inserts[0].rows).toEqual([expect.objectContaining({ duration_ms: 1 })]);

		release();
		await Promise.all([first, second]);

		// Each flush wrote exactly the rows it claimed — no row lost, none doubled.
		expect(inserts).toHaveLength(2);
		expect(inserts[0].rows).toEqual([expect.objectContaining({ duration_ms: 1 })]);
		expect(inserts[1].rows).toEqual([expect.objectContaining({ duration_ms: 2 })]);
	});

	it('swallows a failing flush and clears the batch', async () => {
		const { bundle, inserts } = fakeBundle({ fail: true });
		const logger = fakeLogger();
		const sink = new SupabaseSolveMetricSink(bundle, { maxBatchSize: 1, logger });

		await sink.record(ctx, metric());
		await expect(sink.flush()).resolves.toBeUndefined();
		expect(logger.error).toHaveBeenCalled();

		// The failed batch is not retried on the next flush.
		await sink.flush();
		expect(inserts).toHaveLength(1);
	});

	it('close drains the buffer and stops accepting records', async () => {
		const { bundle, inserts } = fakeBundle();
		const sink = new SupabaseSolveMetricSink(bundle, {
			maxBatchSize: 100,
			flushIntervalMs: 60_000
		});

		await sink.record(ctx, metric());
		await sink.close();
		expect(inserts).toHaveLength(1);

		await sink.record(ctx, metric());
		await sink.flush();
		expect(inserts).toHaveLength(1);
	});
});
