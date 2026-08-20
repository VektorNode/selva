/**
 * Update-outcome classification (UpdateSection.svelte).
 *
 * `deriveOutcome` is the single decision point that tells an operator whether
 * the app is UP or DOWN after an update, and what to do next. These tests pin
 * every branch — above all the safety-critical distinctions:
 *
 *   • a safe rollback (app online on old version) is `warning`, NOT a failure;
 *   • a failed rollback (app may be offline) is `critical` with recovery steps;
 *   • an unknown non-zero exit is `critical`, never silently "success".
 */

import { describe, it, expect } from 'vitest';
import { deriveOutcome, TIMED_OUT } from '$lib/update-outcome';

describe('deriveOutcome', () => {
	it('is pending while the run has not finished', () => {
		expect(deriveOutcome(null, 'anything').severity).toBe('pending');
	});

	it('reports a clean version transition as success with from→to', () => {
		const logs = [
			'[INFO] Available: 4.2.0 → 4.2.1',
			'[INFO] New @selvajs/selva: 4.2.1',
			'[DONE] Update complete'
		].join('\n');
		const o = deriveOutcome(0, logs);
		expect(o.severity).toBe('success');
		expect(o.from).toBe('4.2.0');
		expect(o.to).toBe('4.2.1');
		expect(o.title).toContain('online');
	});

	it('distinguishes "already up to date" from an actual update', () => {
		const logs = "[INFO] Already on the 'latest' channel version (4.2.1)\n[DONE] Nothing to do";
		const o = deriveOutcome(0, logs);
		expect(o.severity).toBe('info');
		expect(o.title).toMatch(/up to date/i);
	});

	it('treats a safe rollback as a warning, NOT a failure — the app is online', () => {
		const logs = [
			'[INFO] Available: 4.2.1 → 4.3.0',
			'[FATAL] New process failed health check after 30s',
			'[STEP] Rolling back @selvajs/selva to 4.2.1',
			'[DONE] Rolled back to 4.2.1 — previous version is online'
		].join('\n');
		const o = deriveOutcome(5, logs);
		expect(o.severity).toBe('warning');
		expect(o.title).toMatch(/rolled back/i);
		expect(o.title).toMatch(/online/i);
	});

	it('names the database as the cause when a rollback was caused by schema skew', () => {
		const logs = [
			'[INFO] Target (latest): 4.9.0 → 4.14.0',
			'[INFO] New @selvajs/selva: 4.14.0',
			'[FATAL] New process failed health check after 30s',
			'[FATAL] SCHEMA_SKEW: @selvajs/selva@4.14.0 expects database migration head 20260817200000,',
			'[FATAL] but this database is at 20260717120000. The new version is fine — its migrations',
			'[DONE] Rolled back to 4.9.0 — previous version is online'
		].join('\n');
		const o = deriveOutcome(5, logs);
		expect(o.severity).toBe('warning');
		expect(o.title).toContain('20260817200000');
		expect(o.title).toContain('20260717120000');
		expect(o.title).toMatch(/online/i);
		// The operator's whole problem was not knowing the next step.
		expect(o.detail).toContain('supabase db push');
		expect(o.detail).toContain('sync-migrations');
		expect(o.detail).toMatch(/same way/i);
	});

	it('does not fall through to the generic "review the log" rollback text on schema skew', () => {
		const logs = [
			'[FATAL] SCHEMA_SKEW: @selvajs/selva@4.14.0 expects database migration head 20260817200000,',
			'[FATAL] but this database is at 20260717120000. The new version is fine',
			'[DONE] Rolled back to 4.9.0 — previous version is online'
		].join('\n');
		const o = deriveOutcome(5, logs);
		expect(o.detail).not.toMatch(/Review the log below for why/);
	});

	it('attributes an at-rest secret rollback to host configuration, not the release', () => {
		const logs = [
			'[FATAL] New process failed health check after 30s',
			'[FATAL] AT_REST_SECRETS: stored compute server API keys could not be decrypted under the',
			'[DONE] Rolled back to 4.9.0 — previous version is online'
		].join('\n');
		const o = deriveOutcome(5, logs);
		expect(o.severity).toBe('warning');
		expect(o.title).toMatch(/SELVA_AT_REST_KEY/);
		expect(o.detail).toMatch(/not a fault in the new/i);
	});

	it('treats a failed rollback as critical and says the app may be offline', () => {
		const logs = [
			'[FATAL] Rollback restart also failed health check (HTTP 000)',
			'[FATAL] Manual recovery required. Check: pm2 logs selva-compute'
		].join('\n');
		const o = deriveOutcome(6, logs);
		expect(o.severity).toBe('critical');
		expect(o.title).toMatch(/OFFLINE/i);
		expect(o.detail).toMatch(/pm2 start/);
	});

	it('treats the harness timeout as critical with do-not-retry guidance', () => {
		const o = deriveOutcome(TIMED_OUT, 'Waiting for app to come back online…');
		expect(o.severity).toBe('critical');
		expect(o.title).toMatch(/did not come back/i);
		expect(o.detail).toMatch(/crash-loop|background/i);
	});

	it('flags a stale-cache no-op as a warning with recovery steps', () => {
		const logs = '[WARN] No version change (4.2.1). Your npm cache may be stale.';
		const o = deriveOutcome(0, logs);
		expect(o.severity).toBe('warning');
		expect(o.detail).toMatch(/npm cache clean/);
	});

	it('never reports an unknown non-zero exit as success', () => {
		const o = deriveOutcome(99, '[FATAL] something we have no case for');
		expect(o.severity).toBe('critical');
		expect(o.title).toContain('exit code 99');
	});

	it('handles the -> ascii arrow as well as the unicode arrow', () => {
		const o = deriveOutcome(0, '[INFO] Available: 4.2.0 -> 4.2.1\n[DONE] done');
		expect(o.from).toBe('4.2.0');
		expect(o.to).toBe('4.2.1');
	});

	it('does not crash on empty logs', () => {
		expect(() => deriveOutcome(0, '')).not.toThrow();
		expect(deriveOutcome(0, '').severity).toBe('success');
	});
});
