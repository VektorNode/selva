import { describe, it, expect, vi } from 'vitest';
import { isNewer } from '../updateCheck.server';

describe('isNewer', () => {
	it('detects a newer patch / minor / major', () => {
		expect(isNewer('4.3.2', '4.3.1')).toBe(true);
		expect(isNewer('4.4.0', '4.3.9')).toBe(true);
		expect(isNewer('5.0.0', '4.9.9')).toBe(true);
	});

	it('returns false for same or older versions', () => {
		expect(isNewer('4.3.1', '4.3.1')).toBe(false);
		expect(isNewer('4.3.0', '4.3.1')).toBe(false);
		expect(isNewer('3.9.9', '4.0.0')).toBe(false);
	});

	it('ignores pre-release suffixes (only stable bumps surface)', () => {
		expect(isNewer('4.3.2-beta.1', '4.3.1')).toBe(true);
		expect(isNewer('4.3.1-beta.1', '4.3.1')).toBe(false);
	});

	it('falls back to a string compare when unparseable', () => {
		expect(isNewer('weird', 'weird')).toBe(false);
		expect(isNewer('a', 'b')).toBe(true);
	});
});

// fetchLatestVersion is exercised here for its failure-tolerance contract:
// any non-ok / thrown / malformed response must yield null, never throw, so
// the admin page never breaks on a flaky registry.
describe('fetchLatestVersion failure tolerance', () => {
	it('returns null on a non-200 response', async () => {
		const { fetchLatestVersion } = await import('../updateCheck.server');
		const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));
		expect(await fetchLatestVersion(fetchImpl as unknown as typeof fetch)).toBeNull();
	});

	it('returns null when fetch throws', async () => {
		const { fetchLatestVersion } = await import('../updateCheck.server');
		const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
		expect(await fetchLatestVersion(fetchImpl as unknown as typeof fetch)).toBeNull();
	});

	it('returns null when the body has no version string', async () => {
		const { fetchLatestVersion } = await import('../updateCheck.server');
		const fetchImpl = vi.fn().mockResolvedValue(Response.json({ nope: true }));
		expect(await fetchLatestVersion(fetchImpl as unknown as typeof fetch)).toBeNull();
	});

	it('returns the version string on success', async () => {
		const { fetchLatestVersion } = await import('../updateCheck.server');
		const fetchImpl = vi.fn().mockResolvedValue(Response.json({ version: '4.3.5' }));
		expect(await fetchLatestVersion(fetchImpl as unknown as typeof fetch)).toBe('4.3.5');
	});
});
