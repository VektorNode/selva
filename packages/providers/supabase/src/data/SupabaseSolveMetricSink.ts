import type { ISolveMetricSink, RequestContext, SolveMetric } from '@selvajs/platform';
import { NoopLogger, type ILogger } from '@selvajs/platform';
import type { ClientBundle } from './client.js';

type MetricRow = {
	actor_id: string;
	definition_url: string;
	definition_id: string | null;
	version_id: string | null;
	channel: string;
	org_id: string | null;
	duration_ms: number;
	ok: boolean;
	failure_kind: string;
	error_count: number;
	warning_count: number;
};

export interface SolveMetricSinkOptions {
	/** Flush once this many rows are buffered. */
	maxBatchSize?: number;
	/** Flush a non-empty buffer after this many ms, even if under `maxBatchSize`. */
	flushIntervalMs?: number;
	/**
	 * Hard cap on buffered rows. Past this, the oldest rows are dropped so a
	 * stalled or failing backend cannot grow the buffer without bound.
	 */
	maxBufferSize?: number;
	/**
	 * Structured logger for flush failures and buffer drops. Optional; defaults to
	 * `NoopLogger` so this library never writes to stdout unless the app wires one.
	 */
	logger?: ILogger;
}

const DEFAULT_MAX_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 2000;
const DEFAULT_MAX_BUFFER_SIZE = 10_000;

/**
 * Persists solve timings to `selva.solve_metrics`. Writes go through the
 * service-role client — the sink is a system process attached to the compute
 * route, not the requesting user, so RLS doesn't apply.
 *
 * Rows are buffered and batch-written: slider scrubbing fires solves far
 * faster than they're worth individual round-trips against a Postgres that
 * also serves auth. A batch flushes at `maxBatchSize` rows or `flushIntervalMs`
 * elapsed, whichever comes first.
 *
 * `record` must never throw — it runs on the hot path after the solve
 * response is already sent, so it only buffers; a failed flush is logged and
 * swallowed. That means an unclean shutdown loses buffered metrics; call
 * `close()` to drain deliberately.
 */
export class SupabaseSolveMetricSink implements ISolveMetricSink {
	private buffer: MetricRow[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	private inFlight: Promise<void> = Promise.resolve();
	private closed = false;

	private readonly maxBatchSize: number;
	private readonly flushIntervalMs: number;
	private readonly maxBufferSize: number;
	private readonly logger: ILogger;

	constructor(
		private readonly clients: ClientBundle,
		opts: SolveMetricSinkOptions = {}
	) {
		this.maxBatchSize = opts.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
		this.flushIntervalMs = opts.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
		this.maxBufferSize = opts.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
		this.logger = opts.logger ?? new NoopLogger();
	}

	async record(ctx: RequestContext, metric: SolveMetric): Promise<void> {
		if (this.closed) return;

		this.buffer.push({
			actor_id: ctx.userId || 'system',
			definition_url: metric.definitionUrl,
			definition_id: metric.definitionId,
			version_id: metric.versionId,
			channel: metric.channel,
			org_id: metric.orgId,
			duration_ms: metric.durationMs,
			ok: metric.ok,
			failure_kind: metric.failureKind,
			error_count: metric.errorCount,
			warning_count: metric.warningCount
		});

		if (this.buffer.length > this.maxBufferSize) {
			const dropped = this.buffer.length - this.maxBufferSize;
			this.buffer.splice(0, dropped);
			this.logger.error('Metric buffer full, dropped oldest metrics', {
				component: 'SupabaseSolveMetricSink',
				dropped
			});
		}

		if (this.buffer.length >= this.maxBatchSize) {
			void this.flush();
			return;
		}

		this.scheduleFlush();
	}

	/**
	 * Writes everything buffered and resolves once the write settles. Serialized
	 * against any in-flight flush so batches cannot interleave. Never throws.
	 */
	async flush(): Promise<void> {
		// Claim the buffered rows synchronously, before yielding — otherwise a
		// record() landing between here and the write joins a batch already
		// counted as claimed, and the row is written twice or not at all.
		const batch = this.buffer;
		this.buffer = [];
		this.clearTimer();
		if (batch.length === 0) return this.inFlight;

		this.inFlight = this.inFlight.then(() => this.write(batch));
		return this.inFlight;
	}

	/**
	 * Stops the timer, drains the buffer, and makes further `record` calls no-ops.
	 * Call on shutdown so the last partial batch isn't lost.
	 */
	async close(): Promise<void> {
		this.closed = true;
		this.clearTimer();
		await this.flush();
	}

	private scheduleFlush(): void {
		if (this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.flush();
		}, this.flushIntervalMs);
		// Never hold the process open for telemetry.
		this.timer.unref?.();
	}

	private clearTimer(): void {
		if (!this.timer) return;
		clearTimeout(this.timer);
		this.timer = null;
	}

	private async write(batch: MetricRow[]): Promise<void> {
		try {
			const { error } = await this.clients.serviceClient.from('solve_metrics').insert(batch);
			if (error) {
				this.logger.error('Metric batch insert failed', {
					component: 'SupabaseSolveMetricSink',
					count: batch.length,
					err: error.message
				});
			}
		} catch (err) {
			this.logger.error('Unexpected error writing metric batch', {
				component: 'SupabaseSolveMetricSink',
				count: batch.length,
				err: err instanceof Error ? (err.stack ?? err.message) : String(err)
			});
		}
	}
}
