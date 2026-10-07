import { createHmac, createPrivateKey, randomUUID, sign } from 'node:crypto';
import {
	NoopLogger,
	ProviderError,
	type DelegatedSessionStatus,
	type IDelegatedSession,
	type ILogger
} from '@selvajs/platform';

export interface SupabaseDelegatedSessionConfig {
	supabaseUrl: string;
	anonKey: string;
	/** `SUPABASE_JWT_SIGNING_KEY`: a private ES256 JWK the project trusts. Preferred. */
	signingKey?: string;
	/** `SUPABASE_JWT_SECRET`: the legacy HS256 secret. Used only without `signingKey`. */
	jwtSecret?: string;
	logger?: ILogger;
	fetch?: typeof fetch;
	now?: () => number;
}

/** Long enough for one request, short enough that a ban takes effect quickly. */
const TTL_SECONDS = 60;
/** A failed check (network, or a key not yet rotated in) is retried after this long. */
const RECHECK_FAILED_MS = 30_000;

interface CheckEntry {
	result: Promise<DelegatedSessionStatus>;
	/** Null after a success, which is never re-checked. */
	failedAt: number | null;
}

interface Signer {
	alg: 'ES256' | 'HS256';
	kid?: string;
	/** Names the key for an operator, without any key material. */
	label: string;
	hint: string;
	sign(data: Buffer): Buffer;
}

/**
 * Signs short-lived Supabase session JWTs so API-token requests run under the
 * owner's row security. The claims are fixed: `role` is always
 * `authenticated`, never caller-chosen, because the same key can sign a
 * `service_role` token that bypasses every policy.
 *
 * `aud` is required by GoTrue's `getUser` (400 without it); `session_id` is
 * omitted because GoTrue looks it up and rejects one with no session row.
 */
export class SupabaseDelegatedSession implements IDelegatedSession {
	private readonly signer: Signer | null;
	private readonly configError: string | null;
	private readonly logger: ILogger;
	private readonly fetchFn: typeof fetch;
	private readonly now: () => number;
	private readonly baseUrl: string;
	private check: CheckEntry | null = null;

	constructor(private readonly config: SupabaseDelegatedSessionConfig) {
		this.baseUrl = config.supabaseUrl.replace(/\/+$/, '');
		this.logger = config.logger ?? new NoopLogger();
		this.fetchFn = config.fetch ?? fetch;
		this.now = config.now ?? Date.now;
		let signer: Signer | null = null;
		let configError: string | null = null;
		try {
			signer = config.signingKey
				? es256Signer(config.signingKey)
				: config.jwtSecret
					? hs256Signer(config.jwtSecret)
					: null;
			if (!signer) {
				configError =
					'API tokens need SUPABASE_JWT_SIGNING_KEY (or the legacy SUPABASE_JWT_SECRET) so Selva can act as the token owner under row security.';
			}
		} catch (err) {
			configError = err instanceof Error ? err.message : String(err);
		}
		this.signer = signer;
		this.configError = configError;
	}

	status(): Promise<DelegatedSessionStatus> {
		if (!this.signer) return Promise.resolve({ ok: false, message: this.configError! });
		const current = this.check;
		if (
			current &&
			(current.failedAt === null || this.now() - current.failedAt < RECHECK_FAILED_MS)
		) {
			return current.result;
		}
		const next = { failedAt: null } as CheckEntry;
		next.result = this.probe(this.signer).then((status) => {
			if (!status.ok) {
				next.failedAt = this.now();
				this.logger.error('API tokens are off: delegated sessions failed their check', {
					component: 'delegatedSession',
					reason: status.message
				});
			}
			return status;
		});
		this.check = next;
		return next.result;
	}

	async mint(userId: string): Promise<string> {
		const status = await this.status();
		if (!status.ok) throw new ProviderError(status.message, 503);
		return this.signFor(this.signer!, userId);
	}

	/**
	 * Proves PostgREST accepts what this key signs, which a JWKS lookup alone
	 * doesn't: Supabase lists a standby key in the JWKS but only trusts it once
	 * the project has rotated to it. The random `sub` matches no rows, so the
	 * read is empty either way; only a 401 means the key is refused.
	 */
	private async probe(signer: Signer): Promise<DelegatedSessionStatus> {
		try {
			const res = await this.fetchFn(`${this.baseUrl}/rest/v1/orgs?select=id&limit=1`, {
				headers: {
					apikey: this.config.anonKey,
					Authorization: `Bearer ${this.signFor(signer, randomUUID())}`,
					'Accept-Profile': 'selva'
				}
			});
			if (res.ok) return { ok: true };
			if (res.status === 401) {
				return {
					ok: false,
					message: `Supabase rejected a session signed with ${signer.label}. ${signer.hint}`
				};
			}
			return {
				ok: false,
				message: `Couldn't check ${signer.label}: Supabase answered ${res.status}.`
			};
		} catch (err) {
			return {
				ok: false,
				message: `Couldn't reach Supabase to check ${signer.label}: ${err instanceof Error ? err.message : String(err)}`
			};
		}
	}

	private signFor(signer: Signer, userId: string): string {
		const iat = Math.floor(this.now() / 1000);
		const header = { alg: signer.alg, typ: 'JWT', ...(signer.kid ? { kid: signer.kid } : {}) };
		const payload = {
			sub: userId,
			role: 'authenticated',
			aud: 'authenticated',
			iat,
			exp: iat + TTL_SECONDS,
			iss: `${this.baseUrl}/auth/v1`
		};
		const input = `${base64url(header)}.${base64url(payload)}`;
		return `${input}.${signer.sign(Buffer.from(input)).toString('base64url')}`;
	}
}

function base64url(value: object): string {
	return Buffer.from(JSON.stringify(value)).toString('base64url');
}

interface EcJwk {
	kty?: string;
	crv?: string;
	x?: string;
	y?: string;
	d?: string;
	kid?: string;
	key_ops?: string[];
}

/** Accepts the JWK `supabase gen signing-key` prints, or an array of them (a `signing_keys.json`). */
function es256Signer(raw: string): Signer {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(
			'SUPABASE_JWT_SIGNING_KEY is not valid JSON. Expected the private JWK from `supabase gen signing-key --algorithm ES256`.'
		);
	}
	const keys = (Array.isArray(parsed) ? parsed : [parsed]) as EcJwk[];
	const jwk = keys.find((k) => k?.key_ops?.includes('sign')) ?? keys[0];
	if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.x || !jwk.y) {
		throw new Error(
			'SUPABASE_JWT_SIGNING_KEY must be a private ES256 key: kty "EC", crv "P-256", with "d".'
		);
	}
	if (!jwk.kid) {
		throw new Error(
			'SUPABASE_JWT_SIGNING_KEY has no "kid". Supabase matches tokens to keys by it.'
		);
	}
	const key = createPrivateKey({
		key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d },
		format: 'jwk'
	});
	return {
		alg: 'ES256',
		kid: jwk.kid,
		label: `SUPABASE_JWT_SIGNING_KEY (kid ${jwk.kid})`,
		hint:
			'On hosted Supabase, import it as a standby key under Settings → JWT signing keys, then rotate to it. ' +
			'Self-hosted, it must be in JWT_KEYS and JWT_JWKS.',
		// JWS wants the raw r||s form, not DER.
		sign: (data) => sign('sha256', data, { key, dsaEncoding: 'ieee-p1363' })
	};
}

/** Legacy fallback. Stops working once the project revokes its legacy secret. */
function hs256Signer(secret: string): Signer {
	return {
		alg: 'HS256',
		label: 'SUPABASE_JWT_SECRET',
		hint: "Check it matches the project's legacy JWT secret and that the secret hasn't been revoked.",
		sign: (data) => createHmac('sha256', secret).update(data).digest()
	};
}
