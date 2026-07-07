import * as path from 'node:path';
import type {
	IAuthProvider,
	IProxyAuth,
	AuthUser,
	UserManagementResult,
	ListOptions,
	Page
} from '@selvajs/platform';
import { ProviderError } from '@selvajs/platform';
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
// become anyone. There is no runtime check that catches a misconfiguration —
// the deployment IS the security boundary. See README.md for a working
// Caddy config and a curl-based self-test.
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

	constructor(
		private readonly users: AllowlistStore,
		private readonly headers: HeaderNames,
		bootstrapPolicy: BootstrapAllowlistPolicy | undefined
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
				console.warn(
					`[HeaderAuth] No identity headers received on the first non-authed request. ` +
						`Expected one of: ${this.headers.upn}, ${this.headers.email}, ${this.headers.displayName}. ` +
						`If you reach the app through your forward-auth proxy, this means the proxy is not ` +
						`forwarding the configured headers — check your forward_auth / copy_headers config. ` +
						`If you're hitting the app directly (bypassing the proxy), bind the process to ` +
						`127.0.0.1 and only reach it through the proxy. See @selvajs/header-auth-provider README.`
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
		// against its UUID survive, and rebind its UPN to what the proxy
		// actually sends so the next login hits the fast findByUpn path.
		if (!entry && email) {
			const byEmail = await this.users.findByEmail(email);
			if (byEmail) {
				entry = byEmail;
				if (byEmail.upn !== upn.trim().toLowerCase()) {
					await this.users.rebindUpn(byEmail.id, upn).catch(() => {});
				}
			}
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

		// First-sight materialization: fill in display-name / email from the
		// proxy if the row is still bare. Never overwrites operator edits.
		if ((!entry.email && email) || (!entry.displayName && displayName)) {
			await this.users.materializeFromHeaders(entry.id, { email, displayName }).catch(() => {});
			if (email && !entry.email) entry.email = email;
			if (displayName && !entry.displayName) entry.displayName = displayName;
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
		this.proxyAuth = new HeaderProxyAuth(this.users, this.headers, config.bootstrapAllowlistPolicy);
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

	static fromEnv(env: Record<string, string | undefined>): HeaderAuthProvider {
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
			}
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
	 * Allowlist a UPN. Admin POST `/admin/api/users` with `{ email }`; the
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
