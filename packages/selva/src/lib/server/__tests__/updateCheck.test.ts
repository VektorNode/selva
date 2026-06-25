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

	it('ignores pre-release suffixes on the stable channel (only stable bumps surface)', () => {
		expect(isNewer('4.3.2-beta.1', '4.3.1')).toBe(true);
		expect(isNewer('4.3.1-beta.1', '4.3.1')).toBe(false);
		// Explicit stable channel matches the default.
		expect(isNewer('4.3.1-beta.1', '4.3.1', 'stable')).toBe(false);
	});

	it('orders pre-releases on the beta channel', () => {
		// Successive betas of the same core.
		expect(isNewer('4.6.0-beta.2', '4.6.0-beta.1', 'beta')).toBe(true);
		expect(isNewer('4.6.0-beta.1', '4.6.0-beta.2', 'beta')).toBe(false);
		// A newer core beta beats an older stable.
		expect(isNewer('4.6.0-beta.1', '4.5.1', 'beta')).toBe(true);
		// Stable of a core outranks any beta of the same core (promotion).
		expect(isNewer('4.6.0', '4.6.0-beta.9', 'beta')).toBe(true);
		expect(isNewer('4.6.0-beta.9', '4.6.0', 'beta')).toBe(false);
		// Reverting to an OLDER stable is NOT "newer" — the channel switch, not
		// isNewer, is what makes it actionable.
		expect(isNewer('4.5.1', '4.6.0-beta.2', 'beta')).toBe(false);
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

	it('queries the latest dist-tag for the stable channel (default)', async () => {
		const { fetchLatestVersion } = await import('../updateCheck.server');
		const fetchImpl = vi.fn().mockResolvedValue(Response.json({ version: '4.3.5' }));
		await fetchLatestVersion(fetchImpl as unknown as typeof fetch);
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://registry.npmjs.org/@selvajs%2Fselva/latest',
			expect.anything()
		);
	});

	it('queries the beta dist-tag for the beta channel', async () => {
		const { fetchLatestVersion } = await import('../updateCheck.server');
		const fetchImpl = vi.fn().mockResolvedValue(Response.json({ version: '4.6.0-beta.2' }));
		await fetchLatestVersion(fetchImpl as unknown as typeof fetch, 'beta');
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://registry.npmjs.org/@selvajs%2Fselva/beta',
			expect.anything()
		);
	});
});
