/**
 * Supabase serves every API under one origin; the path prefix names the service. For a
 * request-timing classifier (`createRequestTiming` in `@selvajs/server/http`): `db`, `auth` or
 * `storage`, and for the database the table or RPC a call reached (`db jobs`, `db rpc/x`).
 */

const SERVICES: [prefix: string, name: string][] = [
	['/rest/v1/', 'db'],
	['/auth/v1/', 'auth'],
	['/storage/v1/', 'storage']
];

export function supabaseUpstream(url: URL): { key: string; target: string } | undefined {
	const service = SERVICES.find(([prefix]) => url.pathname.startsWith(prefix));
	if (!service) return undefined;
	const [first = '', second = ''] = url.pathname.slice(service[0].length).split('/');
	return { key: service[1], target: `${service[1]} ${first === 'rpc' ? `rpc/${second}` : first}` };
}
