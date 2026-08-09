import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@selvajs/platform';

/**
 * supabase-js surfaces the schema as a type generic, and the bare
 * `SupabaseClient` default is pinned to `'public'` — this alias is what a
 * client with `db: { schema: 'selva' }` actually type-checks as.
 */
export type SelvaSchemaClient = SupabaseClient<any, 'public', 'selva'>;

/** Default schema every engine store targets. */
export const DEFAULT_SCHEMA = 'selva' as const;

/** A client pinned to a caller-chosen schema (opaque generic for non-`'selva'` schemas). */
export type SchemaClient = SupabaseClient<any, string, any>;

export interface ForRequestOptions {
	/** Postgres schema this client targets. Defaults to `'selva'`. */
	schema?: string;
}

/**
 * `forRequest` picks one of three fail-closed modes:
 *  - `ctx.system === true` → service-role, bypasses RLS. Never derive this
 *    flag from a user session — it must come from an explicitly-trusted
 *    server flow (admin paths, janitors, bootstrap).
 *  - `ctx.adapterContext.sessionToken` set → user-scoped, `authenticated`
 *    role, RLS enforces per-user visibility via `auth.uid()`.
 *  - neither → anon role, RLS active, no `auth.uid()`. This is the safety
 *    net: a context built without a forwarded session token and without
 *    `system: true` is untrusted by default.
 *
 * An earlier version fell back to service-role when the session token was
 * missing — fail-OPEN, so a synthetic ctx (e.g. share-token resolve) could
 * silently bypass RLS. Opt into service-role explicitly now, or you get RLS.
 *
 * `forRequest` caches per `(RequestContext, schema)` in a WeakMap so
 * multiple store calls in one HTTP handler share a client — and its fetch
 * connection — without leaking auth across requests.
 */
export interface ClientBundle {
	/** Long-lived service-role client, pinned to the `'selva'` schema. Bypasses RLS. */
	serviceClient: SelvaSchemaClient;
	forRequest(ctx: RequestContext, opts?: ForRequestOptions): SchemaClient;
}

export interface BuildClientOptions {
	supabaseUrl: string;
	anonKey: string;
	serviceRoleKey: string;
}

export function buildClientBundle(opts: BuildClientOptions): ClientBundle {
	// Stateless w.r.t. request identity, so one instance per schema is safe to share.
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

	const serviceClient = serviceFor(DEFAULT_SCHEMA) as SelvaSchemaClient;
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
 * Reads only `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`.
 * Deliberately does not require `SELVA_AT_REST_KEY` — that's only needed for
 * compute-server secret encryption, which an app building its own `'public'`
 * stores never touches. `SupabaseDataProvider.fromEnv` adds that requirement
 * on top.
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
