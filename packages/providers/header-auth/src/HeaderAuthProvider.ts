import * as path from 'node:path';
import type {
	IAuthProvider,
	IProxyAuth,
	AuthUser,
	UserManagementResult,
	ListOptions,
	Page
} from '@selvajs/platform';
import { NoopLogger, ProviderError, type ILogger } from '@selvajs/platform';
import { createAllowlistStore } from './users.js';
import type { AllowlistStore, AllowlistEntry } from './users.js';

// ============================================================================
// HeaderAuthProvider — forward-auth via trusted upstream proxy
// ============================================================================
//
// ⚠ TRUST BOUNDARY ⚠
//
// This provider trusts the headers it reads from incoming requests. That is
// only safe when the deployment guarantees:
//
//   1. A reverse proxy (Caddy `forward_auth`, oauth2-proxy, Authelia, …) is
//      the ONLY network path to the app process. Bind to 127.0.0.1 or
//      firewall the port.
//   2. The proxy authenticates against the upstream IdP before forwarding.
//   3. The proxy STRIPS any client-supplied copies of the trusted headers
//      from inbound requests before adding its own.
//
// If any of those fails, anyone on the network can spoof the headers and
// become anyone. See README.md for a working Caddy config and a curl-based
// self-test.
//
// One of the three is partly self-detecting: a proxy that doesn't strip (3)
// leaves two values in the UPN header, which `identifyFromHeaders` refuses
// with a warning naming the cause. Nothing detects a breach of (1) — a
// request reaching the process directly carries one clean header and is
// indistinguishable from a proxied one. Closing that needs a shared secret
// between proxy and app, deliberately not added: it is a second control over
// the same failure, and an operator who misconfigured header stripping is no
// likelier to have configured a secret correctly. Network isolation is the
// control; the deployment IS the security boundary.
// ============================================================================

interface HeaderNames {
	upn: string;
	email: string;
	displayName: string;
}

const DEFAULT_HEADERS: HeaderNames = {
	upn: 'SELVA-UserPrincipalName',
	email: 'SELVA-Email',
	displayName: 'SELVA-DisplayName'
};

/**
 * Decides whether an unrecognized UPN coming through the proxy should be
 * auto-allowlisted as the bootstrap admin. Returning `true` lets the provider
 * create the allowlist row on the fly; returning `false` keeps the strict
 * "must be pre-allowlisted" behavior. The caller is responsible for narrowing
 * this to first-run + matching-email so the deployment can't be hijacked
 * after the initial setup.
 *
 * Pure: no I/O inside the callback. The hook layer that wires it up checks
 * `hasInstanceAdmin` and `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` itself.
 */
export type BootstrapAllowlistPolicy = (params: {
	upn: string;
	email: string | undefined;
}) => boolean | Promise<boolean>;

export interface HeaderAuthProviderConfig {
	/** Absolute path to the allowlist JSON file (e.g. `/data/header-allowlist.json`). */
	allowlistFilePath: string;
	/**
	 * Header names the proxy sets. Defaults match the README's Caddy example
	 * (`SELVA-UserPrincipalName`, `SELVA-Email`, `SELVA-DisplayName`). Override
	 * to match a different proxy (e.g. oauth2-proxy uses `X-Auth-Request-User`).
	 */
	headers?: Partial<HeaderNames>;
	/**
	 * Optional bootstrap policy. When set AND the policy returns true for an
	 * unrecognized UPN, the provider auto-allowlists that UPN before completing
	 * identification. Used to break the chicken-and-egg on fresh deployments
	 * where no admin exists yet. The caller must scope this tightly — see
	 * `BootstrapAllowlistPolicy`.
	 */
	bootstrapAllowlistPolicy?: BootstrapAllowlistPolicy;
	/**
	 * Structured logger for proxy-misconfiguration diagnostics. Optional; defaults
	 * to `NoopLogger` so this library stays silent unless the app wires one in.
	 */
	logger?: ILogger;
}

function toAuthUser(u: AllowlistEntry): AuthUser {
	return {
		id: u.id,
		// Pre-first-login rows have no materialized email yet — the UPN is what
		// the admin typed when allowlisting (their email, for Entra/M365) and is
		// the only human-readable identifier available. Fall back so user lists
		// show an address instead of a bare UUID until the real email arrives
		// via header materialization.
		email: u.email ?? u.upn,
		metadata: { upn: u.upn, displayName: u.displayName },
		createdAt: u.createdAt,
		lastLoginAt: u.lastLoginAt,
		disabled: u.disabled
	};
}

class HeaderProxyAuth implements IProxyAuth {
	private bootstrapPolicy: BootstrapAllowlistPolicy | undefined;
	// One-shot diagnostic flag. Flipped the first time we see a request that
	// carries none of the configured SELVA-* headers, so deploys with a
	// misconfigured proxy get a single loud warning in the logs without
	// spamming on every anonymous request. Reset is intentional — the
	// process restarts and you see the warning again next deploy.
	private missingHeadersWarned = false;

	// Same one-shot treatment for the opposite misconfiguration: identity
	// headers arriving more than once per request.
	private duplicateUpnWarned = false;

	constructor(
		private readonly users: AllowlistStore,
		private readonly headers: HeaderNames,
		bootstrapPolicy: BootstrapAllowlistPolicy | undefined,
		private readonly logger: ILogger = new NoopLogger()
	) {
		this.bootstrapPolicy = bootstrapPolicy;
	}

	setBootstrapPolicy(policy: BootstrapAllowlistPolicy | null): void {
		this.bootstrapPolicy = policy ?? undefined;
	}

	/**
	 * Names of the configured identity headers, in priority order. Exposed so
	 * the hook layer can emit per-page diagnostics ("you hit /login without
	 * these headers") without having to know provider internals.
	 */
	get configuredHeaderNames(): readonly string[] {
		return [this.headers.upn, this.headers.email, this.headers.displayName];
	}

	/** True iff none of the configured identity headers are present. */
	hasNoIdentityHeaders(headers: Headers): boolean {
		return (
			!headers.get(this.headers.upn) &&
			!headers.get(this.headers.email) &&
			!headers.get(this.headers.displayName)
		);
	}

	async identifyFromHeaders(headers: Headers): Promise<AuthUser | null> {
		const upn = headers.get(this.headers.upn);
		if (!upn || !upn.trim()) {
			// Distinguish "proxy never touched this request" (no SELVA-* headers
			// at all → forward-auth misconfigured or being bypassed) from "proxy
			// is here but didn't populate UPN" (one of the other SELVA-* headers
			// arrived). The first case is the silent-failure mode operators
			// struggle to diagnose, so we log it once per process.
			if (!this.missingHeadersWarned && this.hasNoIdentityHeaders(headers)) {
				this.missingHeadersWarned = true;
				this.logger.warn(
					'No identity headers received on the first non-authed request. ' +
						'If you reach the app through your forward-auth proxy, this means the proxy is not ' +
						'forwarding the configured headers — check your forward_auth / copy_headers config. ' +
						"If you're hitting the app directly (bypassing the proxy), bind the process to " +
						'127.0.0.1 and only reach it through the proxy. See @selvajs/header-auth-provider README',
					{
						component: 'HeaderAuth',
						expectedHeaders: [this.headers.upn, this.headers.email, this.headers.displayName]
					}
				);
			}
			return null;
		}

		// A UPN header carrying more than one value means the proxy is not
		// stripping client-supplied copies before adding its own: `Headers.get`
		// joins repeats with ", ", so a spoofing attempt arrives as
		// "attacker@x.com, real@y.com". A UPN is a single directory identifier
		// and never contains a comma, so this can only be the duplicate case.
		//
		// The lookup below would miss anyway — no allowlisted UPN has a comma —
		// so refusing here changes no outcome. What it adds is a named cause in
		// the logs for a failure that otherwise looks like "user not
		// allowlisted", which is what makes this misconfiguration so hard to
		// diagnose. Checked on the UPN only: display names legitimately contain
		// commas ("Doe, Jane" is standard Entra formatting).
		if (upn.includes(',')) {
			if (!this.duplicateUpnWarned) {
				this.duplicateUpnWarned = true;
				this.logger.warn(
					'Multiple values arrived in the UPN identity header on one request. The ' +
						'forward-auth proxy is not stripping client-supplied copies of the trusted ' +
						'headers before setting its own, so a visitor can submit their own identity ' +
						'alongside the real one. Refusing to identify. Strip the configured headers at ' +
						'site scope, above forward_auth — see the @selvajs/header-auth-provider README.',
					{ component: 'HeaderAuth', header: this.headers.upn }
				);
			}
			return null;
		}

		const email = headers.get(this.headers.email)?.trim() || undefined;
		const displayName = headers.get(this.headers.displayName)?.trim() || undefined;

		let entry = await this.users.findByUpn(upn);

		// Fallback: the proxy's UPN didn't match, but an admin may have
		// pre-allowlisted this person by EMAIL (Entra UPN ≠ mail is common).
		// Adopt that row so the org membership + permissions provisioned
		// against its UUID survive.
		//
		// Deliberately does NOT rebind the row's UPN to the forwarded value.
		// Both headers on this path are proxy-supplied, so a rebind would let a
		// header write identity: a request that matches an existing row by email
		// would permanently repoint that row's lookup key at whatever UPN the
		// request carried, turning a single spoofed request into persistence in
		// the allowlist. The email fallback resolves the same row on every
		// subsequent login, so the only cost is staying on this branch instead
		// of the faster findByUpn path. Repointing a row's UPN is an operator
		// action — `rebindUpn` remains on the store for that.
		if (!entry && email) {
			const byEmail = await this.users.findByEmail(email);
			if (byEmail) entry = byEmail;
		}

		// Bootstrap path: when there's no allowlist row yet AND a bootstrap
		// policy is configured AND it green-lights this UPN, create the row.
		// The policy owner (the hook layer) is responsible for restricting
		// this to first-run + matching-email so the deployment can't be
		// hijacked once admin exists.
		if (!entry && this.bootstrapPolicy) {
			const allowed = await this.bootstrapPolicy({ upn, email });
			if (allowed) {
				try {
					entry = await this.users.createUser(upn);
				} catch {
					// Race: another concurrent request beat us to it. Re-read.
					entry = await this.users.findByUpn(upn);
				}
			}
		}

		if (!entry || entry.disabled) {
			return null;
		}

		// Mirror email / display-name from the proxy whenever they drift. The
		// IdP is the source of truth, so IdP renames and corrected proxy
		// header mappings propagate on the next visit instead of the first
		// materialized value sticking forever.
		if ((email && entry.email !== email) || (displayName && entry.displayName !== displayName)) {
			await this.users.syncFromHeaders(entry.id, { email, displayName }).catch(() => {});
			if (email) entry.email = email;
			if (displayName) entry.displayName = displayName;
		}

		await this.users.touchLastLogin(entry.id).catch(() => {});
		return toAuthUser(entry);
	}
}

export class HeaderAuthProvider implements IAuthProvider {
	private readonly users: AllowlistStore;
	private readonly headers: HeaderNames;

	readonly name = 'Header (Forward Auth)';
	readonly proxyAuth: IProxyAuth;

	constructor(config: HeaderAuthProviderConfig) {
		this.users = createAllowlistStore(config.allowlistFilePath);
		this.headers = { ...DEFAULT_HEADERS, ...config.headers };
		this.proxyAuth = new HeaderProxyAuth(
			this.users,
			this.headers,
			config.bootstrapAllowlistPolicy,
			config.logger ?? new NoopLogger()
		);
	}

	/**
	 * Late-bind a bootstrap-allowlist policy. Useful when the policy needs
	 * runtime state the platform layer owns (e.g. `hasInstanceAdmin`) and
	 * therefore can't be wired up at provider construction time. Pass `null`
	 * to clear.
	 */
	setBootstrapAllowlistPolicy(policy: BootstrapAllowlistPolicy | null): void {
		(this.proxyAuth as HeaderProxyAuth).setBootstrapPolicy(policy);
	}

	static fromEnv(env: Record<string, string | undefined>, logger?: ILogger): HeaderAuthProvider {
		const dir = env.HEADER_AUTH_DATA_DIR ?? env.DATA_PATH;
		if (!dir) {
			throw new Error(
				'Missing required env var: HEADER_AUTH_DATA_DIR (or DATA_PATH as fallback). ' +
					'This directory holds header-allowlist.json — the pre-provisioned UPN list.'
			);
		}
		return new HeaderAuthProvider({
			allowlistFilePath: path.join(dir, 'header-allowlist.json'),
			headers: {
				upn: env.HEADER_AUTH_UPN_HEADER ?? DEFAULT_HEADERS.upn,
				email: env.HEADER_AUTH_EMAIL_HEADER ?? DEFAULT_HEADERS.email,
				displayName: env.HEADER_AUTH_DISPLAY_NAME_HEADER ?? DEFAULT_HEADERS.displayName
			},
			logger
		});
	}

	/**
	 * No tokens are issued by this provider — identity rides on every request
	 * via the trusted-proxy headers. Always returns null; the hook layer
	 * falls through to `proxyAuth.identifyFromHeaders`.
	 */
	async verifyToken(_token: string): Promise<AuthUser | null> {
		return null;
	}

	async getUser(id: string): Promise<AuthUser | null> {
		const u = await this.users.findById(id);
		return u ? toAuthUser(u) : null;
	}

	async listUsers(opts?: ListOptions): Promise<Page<AuthUser> | null> {
		const all = await this.users.listUsers();
		const limit = Math.min(Math.max(1, opts?.limit ?? 25), 200);
		const offset = opts?.cursor ? parseInt(opts.cursor, 10) || 0 : 0;
		const slice = all.slice(offset, offset + limit).map(toAuthUser);
		const nextOffset = offset + slice.length;
		return {
			items: slice,
			nextCursor: nextOffset < all.length ? String(nextOffset) : undefined
		};
	}

	/**
	 * Allowlist a UPN. Admin POST `/api/admin/users` with `{ email }`; the
	 * email IS the UPN for M365 / Entra deployments where they match. For
	 * other IdPs, document the UPN format in your README/onboarding.
	 */
	async createUser(upn: string): Promise<AuthUser> {
		return toAuthUser(await this.users.createUser(upn));
	}

	async deleteUser(id: string): Promise<UserManagementResult> {
		const target = await this.users.findById(id);
		if (!target) return 'not_found';
		try {
			await this.users.deleteUser(id);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async disableUser(id: string): Promise<UserManagementResult> {
		const target = await this.users.findById(id);
		if (!target) return 'not_found';
		try {
			await this.users.setDisabled(id, true);
			return 'ok';
		} catch (err) {
			if (err instanceof ProviderError && err.statusCode === 404) return 'not_found';
			throw err;
		}
	}

	async touchLastLogin(id: string): Promise<void> {
		await this.users.touchLastLogin(id);
	}
}
