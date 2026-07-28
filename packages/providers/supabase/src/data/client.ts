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

/** Default schema every engine store targets. */
export const DEFAULT_SCHEMA = 'selva' as const;

/**
 * A client pinned to a caller-chosen schema. When the schema is `'selva'` this
 * is the narrow `SelvaSchemaClient`; for an app-owned schema (e.g. `'public'`)
 * the schema generic is opaque — the store surface (`.from` / `.rpc`) is the
 * same either way.
 */
export type SchemaClient = SupabaseClient<any, string, any>;

export interface ForRequestOptions {
	/**
	 * Postgres schema this client targets. Defaults to `'selva'` (the engine's
	 * tables). Pass `'public'` (or another app schema) to build stores on the
	 * consuming app's own tables while keeping the same fail-closed RLS
	 * dispatch as the engine stores.
	 */
	schema?: string;
}

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
	/** Long-lived service-role client, pinned to the `'selva'` schema. Bypasses RLS. */
	serviceClient: SelvaSchemaClient;
	/**
	 * Produce (or reuse) a client scoped to this request's identity, targeting
	 * `opts.schema` (default `'selva'`).
	 *  - `ctx.system === true` → service-role (RLS bypassed).
	 *  - `ctx.adapterContext.sessionToken` set → user-scoped (RLS active).
	 *  - neither → anon client (RLS active, no `auth.uid()`).
	 *
	 * The schema pin and the RLS dispatch travel together: an app building
	 * stores on its own `'public'` tables gets the same fail-closed behavior as
	 * engine stores, just aimed at a different schema.
	 */
	forRequest(ctx: RequestContext, opts?: ForRequestOptions): SchemaClient;
}

export interface BuildClientOptions {
	supabaseUrl: string;
	anonKey: string;
	serviceRoleKey: string;
}

export function buildClientBundle(opts: BuildClientOptions): ClientBundle {
	// Long-lived service-role + anon clients, one per schema. Both are stateless
	// w.r.t. request identity, so a single instance is safe to share across all
	// requests targeting the same schema.
	const serviceBySchema = new Map<string, SchemaClient>();
	const anonBySchema = new Map<string, SchemaClient>();

	function serviceFor(schema: string): SchemaClient {
		let client = serviceBySchema.get(schema);
		if (!client) {
			client = createClient(opts.supabaseUrl, opts.serviceRoleKey, {
				db: { schema },
				auth: { persistSession: false, autoRefreshToken: false }
			});
			serviceBySchema.set(schema, client);
		}
		return client;
	}

	function anonFor(schema: string): SchemaClient {
		let client = anonBySchema.get(schema);
		if (!client) {
			client = createClient(opts.supabaseUrl, opts.anonKey, {
				db: { schema },
				auth: { persistSession: false, autoRefreshToken: false }
			});
			anonBySchema.set(schema, client);
		}
		return client;
	}

	// The `'selva'`-pinned service client is exposed directly on the bundle for
	// engine code that reaches for RLS-bypassing reads without a request context.
	const serviceClient = serviceFor(DEFAULT_SCHEMA) as SelvaSchemaClient;

	// Per-request user-scoped clients, keyed first by context then by schema so
	// a handler that touches both `'selva'` and an app schema reuses one client
	// per (request, schema) without leaking auth across requests.
	const perRequestCache = new WeakMap<RequestContext, Map<string, SchemaClient>>();

	return {
		serviceClient,
		forRequest(ctx: RequestContext, forOpts?: ForRequestOptions): SchemaClient {
			const schema = forOpts?.schema ?? DEFAULT_SCHEMA;
			if (ctx.system) return serviceFor(schema);

			const token = extractSessionToken(ctx.adapterContext);
			if (!token) return anonFor(schema);

			let bySchema = perRequestCache.get(ctx);
			if (!bySchema) {
				bySchema = new Map();
				perRequestCache.set(ctx, bySchema);
			}
			const cached = bySchema.get(schema);
			if (cached) return cached;

			const client = createClient(opts.supabaseUrl, opts.anonKey, {
				db: { schema },
				auth: { persistSession: false, autoRefreshToken: false },
				global: {
					headers: { Authorization: `Bearer ${token}` }
				}
			});
			bySchema.set(schema, client);
			return client;
		}
	};
}

/**
 * Build a `ClientBundle` straight from environment variables — the
 * `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` triple,
 * nothing else. Deliberately does NOT require `SELVA_AT_REST_KEY`: that key
 * only matters for compute-server secret encryption, which a consuming app
 * building its own `'public'` stores never touches. `SupabaseDataProvider.fromEnv`
 * layers the at-rest-key requirement on top of this.
 */
export function clientBundleFromEnv(env: Record<string, string | undefined>): ClientBundle {
	const supabaseUrl = env.SUPABASE_URL;
	const anonKey = env.SUPABASE_ANON_KEY;
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!supabaseUrl) throw new Error('Missing required env var: SUPABASE_URL');
	if (!anonKey) throw new Error('Missing required env var: SUPABASE_ANON_KEY');
	if (!serviceRoleKey) throw new Error('Missing required env var: SUPABASE_SERVICE_ROLE_KEY');
	return buildClientBundle({ supabaseUrl, anonKey, serviceRoleKey });
}

function extractSessionToken(adapterContext: unknown): string | undefined {
	if (!adapterContext || typeof adapterContext !== 'object') return undefined;
	const maybe = (adapterContext as { sessionToken?: unknown }).sessionToken;
	return typeof maybe === 'string' && maybe.length > 0 ? maybe : undefined;
}
