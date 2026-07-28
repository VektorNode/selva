import { describe, beforeEach, it } from 'vitest';
import { runSolveMetricSinkConformance, type RecordedSolveMetric } from '@selvajs/platform/testing';
import { SupabaseSolveMetricSink } from '../SupabaseSolveMetricSink.js';
import { buildClientBundle } from '../client.js';
import { readEnv, resetAllData } from './test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('SupabaseSolveMetricSink (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	const ctx = envCtx;
	describe('SupabaseSolveMetricSink', () => {
		beforeEach(async () => {
			await resetAllData(ctx);
		});

		runSolveMetricSinkConformance({
			name: 'SupabaseSolveMetricSink',
			createSink: () => new SupabaseSolveMetricSink(ctx.bundle),
			flushSink: (sink) => (sink as SupabaseSolveMetricSink).flush(),
			readRows: async () => {
				const { data, error } = await ctx.adminClient
					.from('solve_metrics')
					.select(
						'actor_id, definition_url, definition_id, version_id, channel, org_id, duration_ms, ok, failure_kind, error_count, warning_count'
					)
					.order('occurred_at', { ascending: true });
				if (error) throw new Error(`solve_metrics read failed: ${error.message}`);
				return (data ?? []).map(
					(r): RecordedSolveMetric => ({
						actorId: r.actor_id,
						definitionUrl: r.definition_url,
						definitionId: r.definition_id,
						versionId: r.version_id,
						channel: r.channel,
						orgId: r.org_id,
						durationMs: r.duration_ms,
						ok: r.ok,
						failureKind: r.failure_kind,
						errorCount: r.error_count,
						warningCount: r.warning_count
					})
				);
			},
			// Point the sink at a bundle whose service key is bogus, so the insert
			// fails. record() must still resolve (contract: never throw).
			createFailingSink: () =>
				new SupabaseSolveMetricSink(
					buildClientBundle({
						supabaseUrl: ctx.url,
						anonKey: ctx.anonKey,
						serviceRoleKey: 'invalid-service-role-key'
					})
				)
		});
	});
}
