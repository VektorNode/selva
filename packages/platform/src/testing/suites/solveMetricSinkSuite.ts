/**
 * Adapter conformance suite for the solve-metric-sink contract.
 *
 * Unlike `IEventSink`, an `ISolveMetricSink` is not driven by store mutations —
 * the compute route calls `record()` directly, once per solve attempt. So this
 * suite is a round-trip: hand a `SolveMetric` to the sink, then read the row
 * back through an adapter-supplied `readRows` and assert the persisted shape.
 *
 * It also pins the contract's hard guarantee: `record` MUST NOT throw, even on
 * a backend failure — the compute route depends on that to keep serving the
 * response after a solve.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ISolveMetricSink, SolveMetric, RequestContext } from '../../index.js';

/**
 * Adapter's view of a persisted metric, normalized back to the `SolveMetric`
 * shape plus the recorded `actorId`. Implementations map their column names
 * onto these fields so the suite stays storage-agnostic.
 */
export interface RecordedSolveMetric extends SolveMetric {
	/** The actor the sink derived from the `RequestContext` it was handed. */
	actorId: string;
}

export interface SolveMetricSinkConformanceOptions {
	name: string;
	/** Build a fresh sink against the adapter's backend. */
	createSink: () => Promise<ISolveMetricSink> | ISolveMetricSink;
	/** Read every persisted metric back, normalized to `RecordedSolveMetric`. */
	readRows: () => Promise<RecordedSolveMetric[]>;
	/**
	 * Build a sink whose backing store is broken so writes fail. Used to prove
	 * `record` swallows errors. Omit if the adapter can't simulate a failure;
	 * the throw-safety test is skipped when absent.
	 */
	createFailingSink?: () => Promise<ISolveMetricSink> | ISolveMetricSink;
	/** Optional per-test cleanup (truncate the metrics table, etc.). */
	cleanup?: () => Promise<void> | void;
}

function sysCtx(userId: string): RequestContext {
	return { userId, platformPermissions: [], orgPermissions: [], system: true };
}

function baseMetric(overrides: Partial<SolveMetric> = {}): SolveMetric {
	return {
		definitionUrl: 'local:00000000-0000-0000-0000-0000000000aa',
		definitionId: '00000000-0000-0000-0000-0000000000aa',
		versionId: '00000000-0000-0000-0000-0000000000bb',
		channel: 'live',
		orgId: '00000000-0000-0000-0000-0000000000cc',
		durationMs: 123.5,
		ok: true,
		failureKind: 'ok',
		errorCount: 0,
		warningCount: 0,
		...overrides
	};
}

export function runSolveMetricSinkConformance(opts: SolveMetricSinkConformanceOptions): void {
	const { name, createSink, readRows, createFailingSink, cleanup } = opts;

	describe(`ISolveMetricSink conformance: ${name}`, () => {
		let sink: ISolveMetricSink;

		beforeEach(async () => {
			sink = await createSink();
		});

		afterEach(async () => {
			if (cleanup) await cleanup();
		});

		it('persists a successful solve with all fields intact', async () => {
			const metric = baseMetric();
			await sink.record(sysCtx('user-1'), metric);

			const rows = await readRows();
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ ...metric, actorId: 'user-1' });
		});

		it('records the actor from the RequestContext', async () => {
			await sink.record(sysCtx('user-xyz'), baseMetric());
			const rows = await readRows();
			expect(rows[0].actorId).toBe('user-xyz');
		});

		it('falls back to "system" when the context has no user id', async () => {
			await sink.record(sysCtx(''), baseMetric());
			const rows = await readRows();
			expect(rows[0].actorId).toBe('system');
		});

		it('persists a failed solve with its failureKind and zero duration', async () => {
			await sink.record(
				sysCtx('user-1'),
				baseMetric({ ok: false, failureKind: 'timeout', durationMs: 0 })
			);
			const rows = await readRows();
			expect(rows[0]).toMatchObject({ ok: false, failureKind: 'timeout', durationMs: 0 });
		});

		it('persists error/warning counts on an otherwise-ok solve', async () => {
			await sink.record(sysCtx('user-1'), baseMetric({ errorCount: 2, warningCount: 5 }));
			const rows = await readRows();
			expect(rows[0]).toMatchObject({ ok: true, errorCount: 2, warningCount: 5 });
		});

		it('persists null definition/version/org for remote-URL solves', async () => {
			await sink.record(
				sysCtx('user-1'),
				baseMetric({
					definitionUrl: 'https://example.com/def.gh',
					definitionId: null,
					versionId: null,
					orgId: null
				})
			);
			const rows = await readRows();
			expect(rows[0]).toMatchObject({ definitionId: null, versionId: null, orgId: null });
		});

		if (createFailingSink) {
			it('does not throw when the backing write fails', async () => {
				const failing = await createFailingSink();
				// The contract: record swallows the failure and resolves.
				await expect(failing.record(sysCtx('user-1'), baseMetric())).resolves.toBeUndefined();
			});
		}
	});
}
