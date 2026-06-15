import type { ISolveMetricSink, RequestContext, SolveMetric } from '@selvajs/platform';
import type { ClientBundle } from './client.js';

/**
 * Persists every solve's timing to `selva.solve_metrics`. Writes use the
 * service-role client so RLS does not gate the telemetry — the sink runs as a
 * system process attached to the compute route, not the requesting user.
 *
 * Per the `ISolveMetricSink` contract, `record` MUST NOT throw. It sits on the
 * hot path of every solve and the response has already been produced by the
 * time we're here, so a failed insert is logged and swallowed.
 */
export class SupabaseSolveMetricSink implements ISolveMetricSink {
	constructor(private readonly clients: ClientBundle) {}

	async record(_ctx: RequestContext, metric: SolveMetric): Promise<void> {
		try {
			const { error } = await this.clients.serviceClient.from('solve_metrics').insert({
				actor_id: _ctx.userId || 'system',
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
			if (error) {
				console.error('[SupabaseSolveMetricSink] insert failed:', error.message, { metric });
			}
		} catch (err) {
			console.error('[SupabaseSolveMetricSink] unexpected error:', err, { metric });
		}
	}
}
