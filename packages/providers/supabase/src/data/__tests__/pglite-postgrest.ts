/**
 * Runs a store's supabase-js calls against PGlite, so a conformance suite needs no live stack.
 * This answers the slice of PostgREST a simple store sends: `select`, `order`, and
 * `eq`/`neq`/`in`/`is.null` filters on GET, PATCH and DELETE, plus POST inserts. Anything else
 * throws, rather than answering wrong.
 */

import type { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import type { RequestContext } from '@selvajs/platform';
import type { ClientBundle, SchemaClient, SelvaSchemaClient } from '../client.js';
import { asRole, type Claims } from './pglite-harness.js';

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
	if (!IDENT.test(name)) throw new Error(`pglite-postgrest: unsupported identifier '${name}'`);
	return name;
}

interface Query {
	params: unknown[];
	where: string;
	columns: string;
	order: string;
}

function parseQuery(url: URL): Query {
	const params: unknown[] = [];
	const where: string[] = [];
	let columns = '*';
	let order = '';
	for (const [key, value] of url.searchParams) {
		if (key === 'select') {
			columns = value === '*' ? '*' : value.split(',').map(ident).join(', ');
			continue;
		}
		if (key === 'order') {
			const terms = value.split(',').map((term) => {
				const [col, dir] = term.split('.');
				return `${ident(col)} ${dir === 'desc' ? 'desc' : 'asc'}`;
			});
			order = ` order by ${terms.join(', ')}`;
			continue;
		}
		const col = ident(key);
		const dot = value.indexOf('.');
		const op = value.slice(0, dot);
		const operand = value.slice(dot + 1);
		if (op === 'eq' || op === 'neq') {
			params.push(operand);
			where.push(`${col}::text ${op === 'eq' ? '=' : '<>'} $${params.length}`);
		} else if (op === 'in') {
			const list = operand
				.replace(/^\(|\)$/g, '')
				.split(',')
				.map((v) => v.replace(/^"|"$/g, ''));
			params.push(list);
			where.push(`${col}::text = any($${params.length})`);
		} else if (op === 'is' && operand === 'null') {
			where.push(`${col} is null`);
		} else {
			throw new Error(`pglite-postgrest: unsupported filter ${key}=${value}`);
		}
	}
	return {
		params,
		where: where.length ? ` where ${where.join(' and ')}` : '',
		columns,
		order
	};
}

function buildSql(method: string, table: string, q: Query, body: unknown, returning: string) {
	if (method === 'GET') return `select ${q.columns} from ${table}${q.where}${q.order}`;
	if (method === 'DELETE') return `delete from ${table}${q.where}${returning}`;
	if (method !== 'POST' && method !== 'PATCH') {
		throw new Error(`pglite-postgrest: unsupported method ${method}`);
	}
	const row = body as Record<string, unknown>;
	const keys = Object.keys(row).map(ident);
	const slots = keys.map((k) => {
		q.params.push(row[k]);
		return `$${q.params.length}`;
	});
	if (method === 'POST') {
		return `insert into ${table} (${keys.join(', ')}) values (${slots.join(', ')})${returning}`;
	}
	const set = keys.map((k, i) => `${k} = ${slots[i]}`).join(', ');
	return `update ${table} set ${set}${q.where}${returning}`;
}

/** A bearer of `service` runs as `service_role`, `anon` as `anon`, any other as the `sub` of an `authenticated` request. */
function postgrestFetch(db: PGlite): typeof fetch {
	return async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		const method = (init?.method ?? 'GET').toUpperCase();
		const headers = new Headers(init?.headers);
		const token = (headers.get('authorization') ?? '').replace(/^Bearer\s*/i, '');
		// supabase-js sends its key as the bearer when no session is set.
		const role =
			token === 'service' ? 'service_role' : token && token !== 'anon' ? 'authenticated' : 'anon';
		const claims: Claims = role === 'authenticated' ? { sub: token } : {};
		const table = `selva.${ident(url.pathname.replace(/^\/rest\/v1\//, ''))}`;
		const wantsRows =
			method === 'GET' || (headers.get('prefer') ?? '').includes('return=representation');

		const q = parseQuery(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		const sql = buildSql(method, table, q, body, wantsRows ? ` returning ${q.columns}` : '');

		try {
			const rows = await asRole(db, role, sql, q.params, claims);
			const status = method === 'POST' ? 201 : wantsRows ? 200 : 204;
			return wantsRows ? Response.json(rows, { status }) : new Response(null, { status });
		} catch (err) {
			const e = err as { code?: string; message?: string; detail?: string };
			const status =
				e.code === '23505' || e.code === '23503' ? 409 : e.code === '42501' ? 403 : 400;
			return Response.json(
				{ code: e.code, message: e.message, details: e.detail ?? null, hint: null },
				{ status }
			);
		}
	};
}

/** A `ClientBundle` over PGlite. A session token is the id of the user it signs in as. */
export function pgliteClientBundle(db: PGlite): ClientBundle {
	const fetchImpl = postgrestFetch(db);
	const client = (token?: string) =>
		createClient('http://pglite.test', 'anon', {
			db: { schema: 'selva' },
			auth: { persistSession: false, autoRefreshToken: false },
			global: {
				fetch: fetchImpl,
				headers: token ? { Authorization: `Bearer ${token}` } : {}
			}
		});
	const serviceClient = client('service') as SelvaSchemaClient;
	return {
		serviceClient,
		forRequest(ctx: RequestContext): SchemaClient {
			if (ctx.system) return serviceClient;
			const adapter = ctx.adapterContext as { sessionToken?: string } | undefined;
			return client(adapter?.sessionToken);
		}
	};
}
