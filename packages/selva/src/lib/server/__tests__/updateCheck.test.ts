import { describe, it, expect, vi } from 'vitest';

// fetchLatestVersion's failure-tolerance contract: any non-ok / thrown /
// malformed response must yield null, never throw, so the admin page never
// breaks on a flaky registry.
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

// ============================================================================
// Node engine pre-flight
// ============================================================================

function registry(body: unknown): typeof fetch {
	return (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
}

describe('fetchLatestManifest', () => {
	it('reads engines.node from the same response as version — no extra request', async () => {
		const { fetchLatestManifest } = await import('../updateCheck.server');
		let calls = 0;
		const f = (async () => {
			calls++;
			return { ok: true, json: async () => ({ version: '4.8.0', engines: { node: '>=22.0.0' } }) };
		}) as unknown as typeof fetch;
		expect(await fetchLatestManifest(f)).toEqual({ version: '4.8.0', enginesNode: '>=22.0.0' });
		expect(calls).toBe(1);
	});

	it('reports a null range when the manifest has no engines field', async () => {
		const { fetchLatestManifest } = await import('../updateCheck.server');
		const m = await fetchLatestManifest(registry({ version: '4.8.0' }));
		expect(m).toEqual({ version: '4.8.0', enginesNode: null });
	});

	it('degrades to nulls when the registry is unreachable', async () => {
		const { fetchLatestManifest } = await import('../updateCheck.server');
		const f = (async () => {
			throw new Error('network down');
		}) as unknown as typeof fetch;
		expect(await fetchLatestManifest(f)).toEqual({ version: null, enginesNode: null });
	});
});

describe('checkForUpdate nodeCompatibility', () => {
	const manifest = { version: '4.8.0-beta.4', engines: { node: '>=22.0.0' } };

	it('flags the incident: Node 20 host, release requiring >=22', async () => {
		const { checkForUpdate } = await import('../updateCheck.server');
		const r = await checkForUpdate(registry(manifest), 'beta', '20.20.2');
		expect(r.nodeCompatibility).toEqual({
			compatible: false,
			required: '>=22.0.0',
			running: '20.20.2'
		});
	});

	it('passes on a host that satisfies the range', async () => {
		const { checkForUpdate } = await import('../updateCheck.server');
		const r = await checkForUpdate(registry(manifest), 'beta', '22.4.0');
		expect(r.nodeCompatibility.compatible).toBe(true);
	});

	// A null must read as "couldn't determine", never as a block — the UI keys
	// the Update button off `=== false` precisely so these cases stay usable.
	it('is null (not false) when the release declares no engines', async () => {
		const { checkForUpdate } = await import('../updateCheck.server');
		const r = await checkForUpdate(registry({ version: '4.8.0' }), 'stable', '20.0.0');
		expect(r.nodeCompatibility.compatible).toBeNull();
	});

	it('is null (not false) when the registry is unreachable', async () => {
		const { checkForUpdate } = await import('../updateCheck.server');
		const f = (async () => ({ ok: false })) as unknown as typeof fetch;
		const r = await checkForUpdate(f, 'stable', '20.0.0');
		expect(r.nodeCompatibility.compatible).toBeNull();
	});

	it('is null (not false) when the range is unparseable', async () => {
		const { checkForUpdate } = await import('../updateCheck.server');
		const weird = { version: '4.8.0', engines: { node: 'whatever-lts' } };
		const r = await checkForUpdate(registry(weird), 'stable', '22.0.0');
		expect(r.nodeCompatibility.compatible).toBeNull();
	});
});
