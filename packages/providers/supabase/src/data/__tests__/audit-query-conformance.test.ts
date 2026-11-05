import { describe, beforeEach, it } from 'vitest';
import { runAuditQueryConformance } from '@selvajs/platform/testing';
import { SupabaseAuditQuery } from '../SupabaseAuditQuery.js';
import { SupabaseEventSink } from '../SupabaseEventSink.js';
import { readEnv, resetAllData } from './test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('audit query conformance (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	describe('SupabaseAuditQuery', () => {
		beforeEach(async () => {
			await resetAllData(envCtx);
		});

		runAuditQueryConformance({
			name: 'SupabaseAuditQuery',
			createStores: () => ({
				query: new SupabaseAuditQuery(envCtx.bundle),
				sink: new SupabaseEventSink(envCtx.bundle)
			})
		});
	});
}
