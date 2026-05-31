import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@selvajs/platform';

/**
 * All engine tables live in the `selva` schema (not `public`) so a consuming
 * app keeps `public` for its own tables. Every data client targets `selva` via
 * `db: { schema: 'selva' }`, which the supabase-js type system surfaces as the
 * client's schema generic — hence this alias rather than the bare default
 * `SupabaseClient` (which is pinned to `'public'`).
 */
export type SelvaSchemaClient = SupabaseClient<any, 'public', 'selva'>;

/**
 * Build a Supabase client for a given `RequestContext`.
 *
 * Three modes — fail-closed:
 *  - **Service-role** ONLY when `ctx.system === true`. Bypasses RLS. Used for
 *    admin paths, janitors, bootstrap, and any explicitly-trusted server
 *    flow. The system flag must never be derived from a user session.
 *  - **User-scoped** when `ctx.adapterContext.sessionToken` is a JWT: runs
 *    under `authenticated` role with `auth.uid()` from the token. RLS
 *    policies enforce per-user visibility.
 *  - **Anonymous** otherwise: runs under the `anon` role. RLS is active and
 *    will scope reads/writes accordingly. This is the safety net — any code
 *    that constructs a context without forwarding the session token AND
 *    without setting `system: true` is treated as untrusted.
 *
 * Previous versions fell back to service-role when the session token was
 * absent — a fail-OPEN footgun: any synthetic ctx (e.g. share-token resolve)
 * silently bypassed RLS. The current contract is explicit: opt into
 * service-role with `system: true`, or you get RLS.
 *
 * Per-request WeakMap caching keeps a single client alive for the lifetime
 * of a RequestContext — multiple store calls in one HTTP handler share one
 * fetch connection without leaking auth across requests.
 */
export interface ClientBundle {
	/** Long-lived service-role client. Bypasses RLS. */
	serviceClient: SelvaSchemaClient;
	/**
	 * Produce (or reuse) a client scoped to this request's identity.
	 *  - `ctx.system === true` → service-role (RLS bypassed).
	 *  - `ctx.adapterContext.sessionToken` set → user-scoped (RLS active).
	 *  - neither → anon client (RLS active, no `auth.uid()`).
	 */
	forRequest(ctx: RequestContext): SelvaSchemaClient;
}

export interface BuildClientOptions {
	supabaseUrl: string;
	anonKey: string;
	serviceRoleKey: string;
}

export function buildClientBundle(opts: BuildClientOptions): ClientBundle {
	const serviceClient = createClient(opts.supabaseUrl, opts.serviceRoleKey, {
		db: { schema: 'selva' },
		auth: { persistSession: false, autoRefreshToken: false }
	});

	// Long-lived anon client — the fail-closed default for ctxes that aren't
	// explicitly system and don't carry a session token.
	const anonClient = createClient(opts.supabaseUrl, opts.anonKey, {
		db: { schema: 'selva' },
		auth: { persistSession: false, autoRefreshToken: false }
	});

	const perRequestCache = new WeakMap<RequestContext, SelvaSchemaClient>();

	return {
		serviceClient,
		forRequest(ctx: RequestContext): SelvaSchemaClient {
			if (ctx.system) return serviceClient;

			const token = extractSessionToken(ctx.adapterContext);
			if (!token) return anonClient;

			const cached = perRequestCache.get(ctx);
			if (cached) return cached;

			const client = createClient(opts.supabaseUrl, opts.anonKey, {
				db: { schema: 'selva' },
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
