/**
 * OAuth 2.1 for MCP clients and the Grasshopper plugin, with this instance as
 * its own authorization server.
 *
 * The access token is an ordinary API token. The host mints it while the user is
 * signed in, at consent, through the same path as Team → API tokens; this
 * module seals the raw key into the authorization code and hands it over at the
 * token endpoint. So `/mcp` and `/api/v1` keep one credential type.
 *
 * Nothing here is stored. A registered client's id is its own signed metadata,
 * and a code is its own encrypted grant, bound to the issuing origin. The only
 * state is the set of redeemed codes, in the host's memory, so on several
 * replicas a code could be redeemed once per replica within its minute, and only
 * by whoever holds the PKCE verifier.
 */

import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	hkdfSync,
	randomBytes,
	timingSafeEqual
} from 'node:crypto';

/** The scopes a grant can carry. Each maps to one org-wide API scope. */
export const OAUTH_SCOPES = ['read', 'solve', 'upload'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/**
 * All a registered (DCR or CIMD) client can be granted. Its name and redirects
 * are whatever the registrant chose, so `upload`, which puts code on the org's
 * Compute server, stays with the built-in client and a look-alike can't phish for it.
 */
export const REGISTERED_CLIENT_SCOPES = ['read', 'solve'] as const satisfies readonly OAuthScope[];

/** The Grasshopper plugin's client id. Built in, so it needs no registration and works air-gapped. */
export const GRASSHOPPER_CLIENT_ID = 'selva-grasshopper';

// Loopback on any port (RFC 8252 §7.3), but only this host and path: the code
// can only ever reach a program on the user's own machine.
const GRASSHOPPER_CLIENT: OAuthClient = {
	clientId: GRASSHOPPER_CLIENT_ID,
	name: 'Selva for Grasshopper',
	redirectUris: ['http://127.0.0.1/callback'],
	builtIn: true,
	scopes: ['read', 'upload']
};

export const MCP_PATH = '/mcp';

export const CODE_TTL_MS = 60_000;
const CLIENT_NAME_MAX = 100;
const REDIRECT_URIS_MAX = 10;
const CIMD_TTL_MS = 60 * 60_000;
// A failing metadata URL is not refetched for this long: each fetch is outbound
// work an anonymous caller could otherwise trigger at will.
const CIMD_FAILURE_TTL_MS = 60_000;
const CIMD_CACHE_MAX = 500;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class OAuthError extends Error {
	constructor(
		/** RFC 6749 / 7591 error code. */
		readonly error: string,
		description: string,
		readonly status = 400
	) {
		super(description);
		this.name = 'OAuthError';
	}

	toBody(): { error: string; error_description: string } {
		return { error: this.error, error_description: this.message };
	}
}

export interface OAuthClient {
	clientId: string;
	/** Shown on the consent page. Unverified for a registered client: whatever it claimed. */
	name: string;
	redirectUris: string[];
	/** Shipped with this server, so its name can be trusted. */
	builtIn: boolean;
	/** All this client can be granted, whatever it asks for. */
	scopes: readonly OAuthScope[];
}

/** A validated `/oauth/authorize` request, ready for the consent page. */
export interface AuthorizeRequest {
	client: OAuthClient;
	redirectUri: string;
	state?: string;
	codeChallenge: string;
	scopes: OAuthScope[];
	resource: string;
}

/** What the host minted at consent. `secret` is the raw API key. */
export interface Grant {
	tokenId: string;
	secret: string;
	scopes: OAuthScope[];
	expiresAt: string;
}

export interface OAuthServerOptions {
	/** This instance's origin, e.g. `https://selva.example.com`. */
	origin: string;
	/** `SELVA_HMAC_KEY`. Rotating it invalidates registered clients and live codes. */
	secret: string;
	/**
	 * Fetches a Client ID Metadata Document. The URL comes from an unknown client,
	 * so the host must guard it against SSRF. Without it, URL client ids are refused.
	 */
	fetchClientMetadata?: (url: string) => Promise<unknown>;
	/**
	 * Redeemed code hashes and their expiry. Pass one map for the process so a
	 * rebuilt server (a new origin, a rotated secret) still refuses a replay.
	 */
	redeemedCodes?: Map<string, number>;
	/** Called once a code is exchanged, with the token its grant carries. */
	onRedeemed?: (tokenId: string) => void;
	now?: () => number;
}

interface HttpResult {
	status: number;
	body: Record<string, unknown>;
}

// ============================================================================
// Discovery documents
// ============================================================================

export function mcpResourceUrl(origin: string): string {
	return origin + MCP_PATH;
}

export function resourceMetadataUrl(origin: string): string {
	return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

/** RFC 9728. Claude uses only the first authorization server. */
export function protectedResourceMetadata(origin: string) {
	return {
		resource: mcpResourceUrl(origin),
		authorization_servers: [origin],
		scopes_supported: [...REGISTERED_CLIENT_SCOPES],
		bearer_methods_supported: ['header']
	};
}

/**
 * RFC 8414. Claude picks Client ID Metadata Documents only when both
 * `client_id_metadata_document_supported` and the `none` auth method appear.
 */
export function authorizationServerMetadata(origin: string) {
	return {
		issuer: origin,
		authorization_endpoint: `${origin}/oauth/authorize`,
		token_endpoint: `${origin}/oauth/token`,
		registration_endpoint: `${origin}/oauth/register`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		scopes_supported: [...OAUTH_SCOPES],
		client_id_metadata_document_supported: true,
		authorization_response_iss_parameter_supported: true
	};
}

// ============================================================================
// Server
// ============================================================================

export function createOAuthServer(options: OAuthServerOptions) {
	const { origin } = options;
	const now = options.now ?? Date.now;
	const signKey = derive(options.secret, 'selva-oauth-client');
	const codeKey = derive(options.secret, `selva-oauth-code:${origin}`);
	const redeemed = options.redeemedCodes ?? new Map<string, number>();
	const metadataCache = new Map<
		string,
		{ at: number; client: OAuthClient } | { at: number; failure: OAuthError }
	>();

	// ==========================================================================
	// Clients
	// ==========================================================================

	/** RFC 7591. The client id carries the metadata, signed, so nothing is stored. */
	function register(input: unknown): HttpResult {
		try {
			const meta = (input ?? {}) as { client_name?: unknown; redirect_uris?: unknown };
			const redirectUris = checkRedirectUris(meta.redirect_uris);
			const name = typeof meta.client_name === 'string' ? meta.client_name.trim() : '';
			const payload = b64(
				JSON.stringify({ n: name.slice(0, CLIENT_NAME_MAX), r: redirectUris, t: now() })
			);
			const clientId = `dcr_${payload}.${sign(signKey, payload)}`;
			return {
				status: 201,
				body: {
					client_id: clientId,
					client_id_issued_at: Math.floor(now() / 1000),
					client_name: name || undefined,
					redirect_uris: redirectUris,
					grant_types: ['authorization_code'],
					response_types: ['code'],
					token_endpoint_auth_method: 'none'
				}
			};
		} catch (err) {
			if (err instanceof OAuthError) return { status: err.status, body: err.toBody() };
			throw err;
		}
	}

	async function resolveClient(clientId: string): Promise<OAuthClient> {
		if (clientId === GRASSHOPPER_CLIENT_ID) return GRASSHOPPER_CLIENT;
		if (clientId.startsWith('dcr_')) return registeredClient(clientId);
		if (clientId.startsWith('https://')) return metadataClient(clientId);
		throw new OAuthError('invalid_client', 'Unknown client.');
	}

	function registeredClient(clientId: string): OAuthClient {
		const [payload, signature] = clientId.slice('dcr_'.length).split('.');
		if (!payload || !signature || !safeEqual(signature, sign(signKey, payload))) {
			throw new OAuthError('invalid_client', 'Unknown client.');
		}
		const meta = JSON.parse(unb64(payload)) as { n: string; r: string[] };
		return {
			clientId,
			name: meta.n || 'An MCP client',
			redirectUris: meta.r,
			builtIn: false,
			scopes: REGISTERED_CLIENT_SCOPES
		};
	}

	async function metadataClient(url: string): Promise<OAuthClient> {
		const cached = metadataCache.get(url);
		if (cached) {
			if ('client' in cached && now() - cached.at < CIMD_TTL_MS) return cached.client;
			if ('failure' in cached && now() - cached.at < CIMD_FAILURE_TTL_MS) throw cached.failure;
		}
		if (!options.fetchClientMetadata) {
			throw new OAuthError('invalid_client', 'This server does not accept URL client ids.');
		}
		try {
			const client = await readMetadata(url, options.fetchClientMetadata);
			remember(url, { at: now(), client });
			return client;
		} catch (err) {
			if (!(err instanceof OAuthError)) throw err;
			remember(url, { at: now(), failure: err });
			throw err;
		}
	}

	function remember(url: string, entry: Parameters<typeof metadataCache.set>[1]) {
		if (metadataCache.size >= CIMD_CACHE_MAX) {
			metadataCache.delete(metadataCache.keys().next().value!);
		}
		metadataCache.set(url, entry);
	}

	// ==========================================================================
	// Authorization
	// ==========================================================================

	/**
	 * Validates the query `/oauth/authorize` arrives with. An `OAuthError` from a
	 * bad client or redirect URI must be shown, not redirected: the redirect target
	 * is exactly what can't be trusted.
	 */
	async function parseAuthorizeRequest(query: URLSearchParams): Promise<AuthorizeRequest> {
		const client = await resolveClient(query.get('client_id') ?? '');
		const redirectUri = query.get('redirect_uri') ?? '';
		if (!client.redirectUris.some((r) => redirectMatches(r, redirectUri))) {
			throw new OAuthError(
				'invalid_request',
				'The redirect URI is not registered for this client.'
			);
		}
		if (query.get('response_type') !== 'code') {
			throw new OAuthError('unsupported_response_type', 'Only response_type=code is supported.');
		}
		const codeChallenge = query.get('code_challenge') ?? '';
		if (!codeChallenge || query.get('code_challenge_method') !== 'S256') {
			throw new OAuthError('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
		}
		const resource = query.get('resource') ?? mcpResourceUrl(origin);
		if (!isThisResource(resource)) {
			throw new OAuthError('invalid_target', 'The resource is not this server.');
		}
		return {
			client,
			redirectUri,
			state: query.get('state') ?? undefined,
			codeChallenge,
			scopes: parseScopes(query.get('scope'), client.scopes),
			resource
		};
	}

	/** Where to send the browser after consent: the client's redirect URI with a code. */
	function approve(request: AuthorizeRequest, grant: Grant): string {
		const code = seal(codeKey, {
			c: request.client.clientId,
			r: request.redirectUri,
			p: request.codeChallenge,
			x: now() + CODE_TTL_MS,
			g: grant
		});
		return withParams(request.redirectUri, { code, state: request.state, iss: origin });
	}

	function deny(request: AuthorizeRequest): string {
		return withParams(request.redirectUri, {
			error: 'access_denied',
			state: request.state,
			iss: origin
		});
	}

	// ==========================================================================
	// Token endpoint
	// ==========================================================================

	function exchange(form: URLSearchParams): HttpResult {
		try {
			if (form.get('grant_type') !== 'authorization_code') {
				throw new OAuthError('unsupported_grant_type', 'Only authorization_code is supported.');
			}
			const code = form.get('code') ?? '';
			const sealed = open(codeKey, code) as {
				c: string;
				r: string;
				p: string;
				x: number;
				g: Grant;
			} | null;
			if (!sealed || sealed.x < now()) {
				throw new OAuthError('invalid_grant', 'The code is invalid or expired.');
			}
			if (sealed.c !== form.get('client_id') || sealed.r !== form.get('redirect_uri')) {
				throw new OAuthError('invalid_grant', 'The code was issued to another client.');
			}
			const verifier = form.get('code_verifier') ?? '';
			if (!safeEqual(createHash('sha256').update(verifier).digest('base64url'), sealed.p)) {
				throw new OAuthError('invalid_grant', 'The code_verifier does not match.');
			}
			const resource = form.get('resource');
			if (resource !== null && !isThisResource(resource)) {
				throw new OAuthError('invalid_target', 'The resource is not this server.');
			}
			if (!markRedeemed(code, sealed.x)) {
				throw new OAuthError('invalid_grant', 'The code was already used.');
			}
			const { g } = sealed;
			options.onRedeemed?.(g.tokenId);
			return {
				status: 200,
				body: {
					access_token: g.secret,
					token_type: 'Bearer',
					expires_in: Math.max(0, Math.floor((Date.parse(g.expiresAt) - now()) / 1000)),
					scope: g.scopes.join(' ')
				}
			};
		} catch (err) {
			if (err instanceof OAuthError) return { status: err.status, body: err.toBody() };
			throw err;
		}
	}

	function markRedeemed(code: string, expiresAt: number): boolean {
		const t = now();
		for (const [k, x] of redeemed) if (x < t) redeemed.delete(k);
		const id = createHash('sha256').update(code).digest('base64url');
		if (redeemed.has(id)) return false;
		redeemed.set(id, expiresAt);
		return true;
	}

	function isThisResource(resource: string): boolean {
		const r = resource.replace(/\/$/, '');
		return r === origin || r === mcpResourceUrl(origin);
	}

	return {
		register,
		resolveClient,
		parseAuthorizeRequest,
		approve,
		deny,
		exchange,
		protectedResourceMetadata: () => protectedResourceMetadata(origin),
		authorizationServerMetadata: () => authorizationServerMetadata(origin)
	};
}

export type OAuthServer = ReturnType<typeof createOAuthServer>;

/** OAuth scopes to the API scopes a minted token gets. */
export function apiScopesFor(scopes: readonly OAuthScope[]): string[] {
	return scopes.map((s) => `${s}:all`);
}

// ============================================================================
// Helpers
// ============================================================================

async function readMetadata(
	url: string,
	fetchClientMetadata: (url: string) => Promise<unknown>
): Promise<OAuthClient> {
	let doc: { client_id?: unknown; client_name?: unknown; redirect_uris?: unknown };
	try {
		doc = (await fetchClientMetadata(url)) as typeof doc;
	} catch {
		throw new OAuthError('invalid_client', 'The client metadata document could not be read.');
	}
	if (doc?.client_id !== url) {
		throw new OAuthError('invalid_client', 'The metadata document names a different client_id.');
	}
	return {
		clientId: url,
		name:
			typeof doc.client_name === 'string' && doc.client_name.trim()
				? doc.client_name.trim().slice(0, CLIENT_NAME_MAX)
				: new URL(url).host,
		redirectUris: checkRedirectUris(doc.redirect_uris),
		builtIn: false,
		scopes: REGISTERED_CLIENT_SCOPES
	};
}

/**
 * What the request asks for, within what its client may have. A scope outside
 * that is dropped, not refused, so a client that asks for every advertised
 * scope still signs in with what it may have. Asking for none of them means all
 * of them. `read` rides along with `solve`, which the consent page offers as
 * "read and run solves".
 */
function parseScopes(raw: string | null, allowed: readonly OAuthScope[]): OAuthScope[] {
	const asked = (raw ?? '')
		.split(' ')
		.filter((s): s is OAuthScope => (allowed as readonly string[]).includes(s));
	if (!asked.length) return [...allowed];
	return allowed.filter((s) => asked.includes(s) || (s === 'read' && asked.includes('solve')));
}

/** One access level a consent page offers, and the scopes approving it grants. */
export interface ConsentChoice {
	access: 'read' | 'solve' | 'upload';
	scopes: OAuthScope[];
}

/**
 * The access levels a consent page offers for a request, narrowest first. The
 * user may narrow what the client asked for, never widen it. An upload request
 * is offered as asked: narrowing it to read would leave the client unable to
 * do the one thing it signed in for.
 */
export function consentChoices(scopes: readonly OAuthScope[]): ConsentChoice[] {
	if (scopes.includes('upload')) return [{ access: 'upload', scopes: [...scopes] }];
	const choices: ConsentChoice[] = [{ access: 'read', scopes: ['read'] }];
	if (scopes.includes('solve')) choices.push({ access: 'solve', scopes: [...scopes] });
	return choices;
}

function checkRedirectUris(value: unknown): string[] {
	if (!Array.isArray(value) || !value.length || value.length > REDIRECT_URIS_MAX) {
		throw new OAuthError('invalid_redirect_uri', 'Give between 1 and 10 redirect_uris.');
	}
	for (const uri of value) {
		if (typeof uri !== 'string' || !isAllowedRedirect(uri)) {
			throw new OAuthError(
				'invalid_redirect_uri',
				'Redirect URIs must be https, or http on a loopback address.'
			);
		}
	}
	return value as string[];
}

function isAllowedRedirect(uri: string): boolean {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return false;
	}
	if (url.hash) return false;
	return (
		url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
	);
}

/** A redirect to a program on the user's own machine, which any local process can claim. */
export function isLoopbackRedirect(uri: string): boolean {
	try {
		return LOOPBACK_HOSTS.has(new URL(uri).hostname);
	} catch {
		return false;
	}
}

/** Exact, except a loopback redirect matches on any port (RFC 8252 §7.3). */
export function redirectMatches(registered: string, requested: string): boolean {
	if (registered === requested) return true;
	let a: URL, b: URL;
	try {
		a = new URL(registered);
		b = new URL(requested);
	} catch {
		return false;
	}
	return (
		a.protocol === 'http:' &&
		b.protocol === 'http:' &&
		LOOPBACK_HOSTS.has(a.hostname) &&
		a.hostname === b.hostname &&
		a.pathname === b.pathname &&
		a.search === b.search &&
		!b.hash &&
		!b.username &&
		!b.password
	);
}

function withParams(uri: string, params: Record<string, string | undefined>): string {
	const url = new URL(uri);
	for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
	return url.toString();
}

function derive(secret: string, info: string): Buffer {
	return Buffer.from(hkdfSync('sha256', secret, '', info, 32));
}

function sign(key: Buffer, data: string): string {
	return createHmac('sha256', key).update(data).digest('base64url');
}

function seal(key: Buffer, value: unknown): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

function open(key: Buffer, sealed: string): unknown {
	try {
		const raw = Buffer.from(sealed, 'base64url');
		// Without the length, a short code is checked against however many tag bytes it has.
		const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12), {
			authTagLength: 16
		});
		decipher.setAuthTag(raw.subarray(12, 28));
		const body = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
		return JSON.parse(body.toString('utf8'));
	} catch {
		return null;
	}
}

function b64(text: string): string {
	return Buffer.from(text).toString('base64url');
}

function unb64(text: string): string {
	return Buffer.from(text, 'base64url').toString('utf8');
}

function safeEqual(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}
