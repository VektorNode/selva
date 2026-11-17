import {
	SYSTEM_CONTEXT,
	type IDataProvider,
	type ILogger,
	type PurgeResult,
	type RetentionCutoffs
} from '@selvajs/platform';
import { readSetting, type EnvRecord } from '@selvajs/platform/config';
import { RETENTION_SETTINGS } from '../config/settings.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days each table is kept; undefined keeps it forever. */
export interface RetentionPolicy {
	auditEventsDays?: number;
	solveMetricsDays?: number;
}

/**
 * `SELVA_AUDIT_RETENTION_DAYS` and `SELVA_SOLVE_METRICS_RETENTION_DAYS`. Unset, 0
 * or invalid keeps the table forever: the boot config check reports an invalid value.
 */
export function resolveRetentionPolicy(env: EnvRecord): RetentionPolicy {
	const days = (key: string) => {
		const value = readSetting(
			RETENTION_SETTINGS.find((s) => s.key === key)!,
			env
		);
		return typeof value === 'number' && value > 0 ? value : undefined;
	};
	return {
		auditEventsDays: days('SELVA_AUDIT_RETENTION_DAYS'),
		solveMetricsDays: days('SELVA_SOLVE_METRICS_RETENTION_DAYS')
	};
}

export function retentionCutoffs(policy: RetentionPolicy, now: number): RetentionCutoffs {
	const before = (days?: number) => (days ? new Date(now - days * DAY_MS) : undefined);
	return {
		auditEventsBefore: before(policy.auditEventsDays),
		solveMetricsBefore: before(policy.solveMetricsDays)
	};
}

export interface RetentionJanitor {
	/** One purge now. Undefined when there is nothing to purge or it failed (logged). */
	runOnce(): Promise<PurgeResult | undefined>;
	stop(): void;
}

/**
 * Purges at start and then daily. Inert when the policy keeps everything or the
 * provider has no `purgeExpired`. Every instance may run one: the purge is idempotent.
 */
export function startRetentionJanitor(options: {
	data: Pick<IDataProvider, 'purgeExpired'>;
	policy: RetentionPolicy;
	logger: ILogger;
	intervalMs?: number;
	now?: () => number;
}): RetentionJanitor {
	const { data, policy, logger, intervalMs = DAY_MS, now = Date.now } = options;
	const enabled =
		!!data.purgeExpired &&
		(policy.auditEventsDays !== undefined || policy.solveMetricsDays !== undefined);

	let running: Promise<PurgeResult | undefined> | undefined;
	async function purge(): Promise<PurgeResult | undefined> {
		if (!enabled) return undefined;
		try {
			const result = await data.purgeExpired!(SYSTEM_CONTEXT, retentionCutoffs(policy, now()));
			if (result.auditEvents || result.solveMetrics) {
				logger.info('Retention purge deleted expired rows', {
					component: 'retention',
					auditEvents: result.auditEvents,
					solveMetrics: result.solveMetrics
				});
			}
			return result;
		} catch (err) {
			logger.error('Retention purge failed', {
				component: 'retention',
				err: err instanceof Error ? err.message : String(err)
			});
			return undefined;
		}
	}
	// A slow purge must not overlap the next tick.
	const runOnce = () => (running ??= purge().finally(() => (running = undefined)));

	let timer: ReturnType<typeof setInterval> | undefined;
	if (enabled) {
		void runOnce();
		timer = setInterval(() => void runOnce(), intervalMs);
		// Otherwise the timer holds the process open past shutdown.
		timer.unref?.();
	}
	return { runOnce, stop: () => clearInterval(timer) };
}
