import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { providers } from '$lib/server/providers.server';

/**
 * Readiness probe: can this process serve a real route right now?
 *
 * Distinct from the two health endpoints on either side of it:
 *
 *   • `/api/health` is *liveness*. It answers the instant the Node process
 *     boots, before the provider stores have necessarily been touched — so a
 *     200 there does not mean a real request would succeed. That gap is what
 *     let the post-update UI report "back online" while a click a moment later
 *     hit a 502 through the proxy.
 *   • `/api/admin/system/health` is a *diagnostic*. It re-runs live integrity
 *     checks including a ping of the default Rhino.Compute server, so it
 *     reports non-ok whenever an unrelated dependency is down and can take
 *     ~10s. Neither property is acceptable in a probe something waits on.
 *
 * So this route does the smallest thing that proves real request handling: one
 * read through the data provider, the same call the auth hook makes on every
 * gated request. If the provider is wired and its store is reachable, routes
 * serve. It deliberately touches NOTHING external — no compute server, no
 * network — because an unreachable compute server does not make this app
 * unready, and a probe that conflates the two can never go green on a
 * deployment whose compute is down.
 *
 * Public and unauthenticated (the update poller runs it across a restart, when
 * no session is guaranteed) and safe to be: the body carries a boolean and a
 * fixed reason string, never provider data or counts.
 */
export const GET: RequestHandler = async () => {
	try {
		// `listUsers({ limit: 1 })` is the cheapest read that exercises the real
		// path — it's what the first-run check in `hooks.server.ts` already calls
		// on gated requests. `null` means the provider doesn't implement it
		// (OIDC-only deployments); that's a valid wiring, not a failure.
		await providers.auth.listUsers({ limit: 1 });
		return json({ ready: true }, { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		// 503 so a load balancer or poller reads it as "not yet". The reason is a
		// fixed string — the underlying error can carry connection details, and
		// this route is unauthenticated.
		return json(
			{ ready: false, reason: 'data provider unavailable' },
			{ status: 503, headers: { 'Cache-Control': 'no-store' } }
		);
	}
};
