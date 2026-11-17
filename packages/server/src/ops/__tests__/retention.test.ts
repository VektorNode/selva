import { describe, expect, it, vi } from 'vitest';
import { NoopLogger, type RetentionCutoffs } from '@selvajs/platform';
import { resolveRetentionPolicy, retentionCutoffs, startRetentionJanitor } from '../retention.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-17T00:00:00Z');

describe('resolveRetentionPolicy', () => {
	it('keeps everything when unset, 0 or invalid', () => {
		expect(resolveRetentionPolicy({})).toEqual({});
		expect(
			resolveRetentionPolicy({
				SELVA_AUDIT_RETENTION_DAYS: '0',
				SELVA_SOLVE_METRICS_RETENTION_DAYS: 'ninety'
			})
		).toEqual({});
	});

	it('reads whole days', () => {
		expect(
			resolveRetentionPolicy({
				SELVA_AUDIT_RETENTION_DAYS: '730',
				SELVA_SOLVE_METRICS_RETENTION_DAYS: '90'
			})
		).toEqual({ auditEventsDays: 730, solveMetricsDays: 90 });
	});
});

describe('retentionCutoffs', () => {
	it('sets a cutoff only for a table with a period', () => {
		expect(retentionCutoffs({ solveMetricsDays: 90 }, NOW)).toEqual({
			auditEventsBefore: undefined,
			solveMetricsBefore: new Date(NOW - 90 * DAY)
		});
	});
});

describe('startRetentionJanitor', () => {
	it('purges at start with the policy cutoffs', async () => {
		const seen: RetentionCutoffs[] = [];
		const janitor = startRetentionJanitor({
			data: {
				purgeExpired: async (_ctx, cutoffs) => {
					seen.push(cutoffs);
					return { auditEvents: 1, solveMetrics: 0 };
				}
			},
			policy: { auditEventsDays: 30 },
			logger: new NoopLogger(),
			now: () => NOW
		});
		await janitor.runOnce();
		janitor.stop();
		expect(seen[0]).toEqual({
			auditEventsBefore: new Date(NOW - 30 * DAY),
			solveMetricsBefore: undefined
		});
	});

	it('is inert when the policy keeps everything', async () => {
		const purgeExpired = vi.fn();
		const janitor = startRetentionJanitor({
			data: { purgeExpired },
			policy: {},
			logger: new NoopLogger()
		});
		expect(await janitor.runOnce()).toBeUndefined();
		janitor.stop();
		expect(purgeExpired).not.toHaveBeenCalled();
	});

	it('logs a failed purge instead of throwing', async () => {
		const logger = new NoopLogger();
		const error = vi.spyOn(logger, 'error');
		const janitor = startRetentionJanitor({
			data: {
				purgeExpired: async () => {
					throw new Error('db down');
				}
			},
			policy: { solveMetricsDays: 1 },
			logger
		});
		expect(await janitor.runOnce()).toBeUndefined();
		janitor.stop();
		expect(error).toHaveBeenCalledWith('Retention purge failed', expect.anything());
	});
});
