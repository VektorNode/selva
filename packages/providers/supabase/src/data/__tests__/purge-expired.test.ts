import { describe, expect, it } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { SupabaseDataProvider } from '../SupabaseDataProvider.js';
import type { ClientBundle } from '../client.js';

interface Purge {
	table: string;
	before: string;
}

function recordingBundle(failOn?: string): { bundle: ClientBundle; purges: Purge[] } {
	const purges: Purge[] = [];
	const serviceClient = {
		from(table: string) {
			return {
				delete: () => ({
					lt: async (col: string, before: string) => {
						expect(col).toBe('occurred_at');
						purges.push({ table, before });
						return failOn === table
							? { error: { message: 'down' }, count: null }
							: { error: null, count: 3 };
					}
				})
			};
		}
	};
	return { bundle: { serviceClient } as unknown as ClientBundle, purges };
}

describe('SupabaseDataProvider.purgeExpired', () => {
	it('deletes only the tables given a cutoff', async () => {
		const { bundle, purges } = recordingBundle();
		const provider = SupabaseDataProvider.fromBundle(bundle);
		const before = new Date('2026-01-01T00:00:00Z');

		const result = await provider.purgeExpired(SYSTEM_CONTEXT, { solveMetricsBefore: before });

		expect(purges).toEqual([{ table: 'solve_metrics', before: before.toISOString() }]);
		expect(result).toEqual({ auditEvents: 0, solveMetrics: 3 });
	});

	it('throws when a delete fails, so the janitor logs it', async () => {
		const { bundle } = recordingBundle('audit_events');
		const provider = SupabaseDataProvider.fromBundle(bundle);
		await expect(
			provider.purgeExpired(SYSTEM_CONTEXT, { auditEventsBefore: new Date() })
		).rejects.toThrow(/audit_events/);
	});
});
