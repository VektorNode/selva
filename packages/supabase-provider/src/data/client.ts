import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@selva/platform';

/**
 * Build a Supabase client for a given `RequestContext`.
 *
 * Two modes:
 *  - **Service-role** (`ctx.system === true`, or the context has no session
 *    token): bypasses RLS. Used for admin paths, janitors, tests, and any
 *    platform-admin action that legitimately spans tenants.
 *  - **User-scoped** (`ctx.adapterContext.sessionToken` is a JWT): runs the
 *    query under `authenticated` role with `auth.uid()` resolved from the
 *    token. RLS policies enforce per-user visibility.
 *
 * Per-request WeakMap caching keeps a single client alive for the lifetime
 * of a RequestContext — multiple store calls in one HTTP handler share one
 * fetch connection without leaking auth across requests.
 */
export interface ClientBundle {
	/** Long-lived service-role client. Bypasses RLS. */
	serviceClient: SupabaseClient;
	/**
	 * Produce (or reuse) a client scoped to this request's identity.
	 * When `ctx.system` is true or no sessionToken is present, returns the
	 * service-role client — callers should not assume RLS is active.
	 */
	forRequest(ctx: RequestContext): SupabaseClient;
}

export interface BuildClientOptions {
	supabaseUrl: string;
	anonKey: string;
	serviceRoleKey: string;
}

export function buildClientBundle(opts: BuildClientOptions): ClientBundle {
	const serviceClient = createClient(opts.supabaseUrl, opts.serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});

	const perRequestCache = new WeakMap<RequestContext, SupabaseClient>();

	return {
		serviceClient,
		forRequest(ctx: RequestContext): SupabaseClient {
			if (ctx.system) return serviceClient;

			const token = extractSessionToken(ctx.adapterContext);
			if (!token) return serviceClient;

			const cached = perRequestCache.get(ctx);
			if (cached) return cached;

			const client = createClient(opts.supabaseUrl, opts.anonKey, {
				auth: { persistSession: false, autoRefreshToken: false },
				global: {
					headers: { Authorization: `Bearer ${token}` }
				}
			});
			perRequestCache.set(ctx, client);
			return client;
		}
	};
}

function extractSessionToken(adapterContext: unknown): string | undefined {
	if (!adapterContext || typeof adapterContext !== 'object') return undefined;
	const maybe = (adapterContext as { sessionToken?: unknown }).sessionToken;
	return typeof maybe === 'string' && maybe.length > 0 ? maybe : undefined;
}
