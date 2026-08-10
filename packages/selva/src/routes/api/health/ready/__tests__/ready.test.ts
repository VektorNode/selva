/**
 * `/api/health/ready` answers "would a real request succeed right now?".
 *
 * It exists because neither neighbour can answer that: `/api/health` is pure
 * liveness (200 the instant the process boots, before routes necessarily
 * serve), and `/api/admin/system/health` pings the compute server, so it
 * reports non-ok whenever an unrelated dependency is down. The post-update
 * restart poll waits on this, so a probe that conflates "compute is down" with
 * "app is not ready" turns a successful update into a reported failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const listUsers = vi.fn();

vi.mock('$lib/server/providers.server', () => ({
	providers: {
		get auth() {
			return { listUsers };
		}
	}
}));

const { GET } = await import('../+server.js');

async function probe() {
	const res = (await GET({} as never)) as Response;
	return { status: res.status, body: await res.json() };
}

beforeEach(() => {
	listUsers.mockReset();
});

describe('GET /api/health/ready', () => {
	it('reports ready when the provider serves a real read', async () => {
		listUsers.mockResolvedValue({ items: [] });

		expect(await probe()).toEqual({ status: 200, body: { ready: true } });
	});

	it('reports ready when the provider does not implement listUsers', async () => {
		// OIDC-only deployments return null rather than a page. That's a valid
		// wiring, not a failure — treating it as unready would leave those
		// deployments permanently "restarting" after an update.
		listUsers.mockResolvedValue(null);

		expect(await probe()).toEqual({ status: 200, body: { ready: true } });
	});

	it('reports 503 when the provider throws', async () => {
		listUsers.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:5432'));

		expect(await probe()).toEqual({
			status: 503,
			body: { ready: false, reason: 'data provider unavailable' }
		});
	});

	it('does not leak the underlying error to an unauthenticated caller', async () => {
		// The route is public, so the reason is a fixed string. Provider errors
		// carry hosts, ports, and connection strings.
		listUsers.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:5432 user=selva_admin'));

		const { body } = await probe();
		expect(JSON.stringify(body)).not.toContain('10.0.0.5');
		expect(JSON.stringify(body)).not.toContain('selva_admin');
	});

	it('never caches — a stale 200 would confirm a restart that had not happened', async () => {
		listUsers.mockResolvedValue({ items: [] });
		const res = (await GET({} as never)) as Response;

		expect(res.headers.get('Cache-Control')).toBe('no-store');
	});
});
