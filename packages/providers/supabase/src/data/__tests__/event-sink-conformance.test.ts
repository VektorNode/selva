import { describe, beforeEach, it } from 'vitest';
import { runEventSinkConformance, type RecordingEventSink } from '@selvajs/platform/testing';
import { SupabaseDataProvider } from '../SupabaseDataProvider.js';
import { readEnv, resetAllData, seedUser } from './test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('SupabaseDataProvider event-sink (skipped: no live stack)', () => {
		it('populate packages/supabase-provider/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	describe('SupabaseDataProvider event-sink', () => {
		beforeEach(async () => {
			await resetAllData(envCtx);
		});

		runEventSinkConformance({
			name: 'SupabaseDataProvider',
			createProvider: (sink: RecordingEventSink) =>
				SupabaseDataProvider.create(
					{
						supabaseUrl: envCtx.url,
						anonKey: envCtx.anonKey,
						serviceRoleKey: envCtx.serviceRoleKey
					},
					sink
				),
			createActorId: () => seedUser(envCtx, '')
		});
	});
}
