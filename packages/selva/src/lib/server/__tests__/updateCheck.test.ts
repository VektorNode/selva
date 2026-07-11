import { describe, it, expect, vi } from 'vitest';

// isNewer's own tests moved with it to @selvajs/server/ops (semver.test.ts).

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
