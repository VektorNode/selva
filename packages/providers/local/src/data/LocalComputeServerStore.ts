import * as path from 'node:path';
import {
	isOrgServer,
	isPlatformServer,
	type IComputeServerStore,
	type ComputeConfig,
	type ComputeServerConfig,
	type GetConfigOptions,
	type PlatformComputeServer,
	type RequestContext,
	type SecretVerificationFailure,
	type SecretVerificationReport,
	type ILogger
} from '@selvajs/platform';
import { NoopLogger } from '@selvajs/platform';
import { readJsonFile, writeJsonFile } from './fsJson.js';
import {
	decodeSecretKey,
	decryptSecret,
	encryptSecret,
	isEncryptedSecret
} from './secretCrypto.js';

// Re-exported from `@selvajs/platform` (`computeServer/secrets`) — kept here so
// the local provider's public surface (index.ts) stays backward-compatible.
export type {
	SecretVerificationFailure,
	SecretVerificationFailureReason,
	SecretVerificationReport
} from '@selvajs/platform';

/**
 * On-disk shape of compute.config.json: all servers (platform + org-private)
 * in one array, the global `defaultServerId`, and the per-org `orgDefaults`
 * map. `apiKey` is always stored as an `enc:v1:<…>` envelope (AES-256-GCM);
 * the store decrypts on read so callers see plaintext.
 */
interface OnDiskShape {
	servers: ComputeServerConfig[];
	defaultServerId?: string;
	orgDefaults?: Record<string, string>;
}

// `readJsonFile` returns its fallback BY REFERENCE when the file is missing,
// so a shared module-level constant would let mutations bleed across calls.
const empty = (): OnDiskShape => ({ servers: [], orgDefaults: {} });

/**
 * Reads/writes compute.config.json, re-read on every call so edits take
 * effect without a restart. Mutation methods are scope-targeted
 * (`savePlatformServers`, `saveOrgServers`, `setOrgDefault`) — each leaves
 * rows in the other scopes untouched.
 */
export class LocalComputeServerStore implements IComputeServerStore {
	static fromEnv(
		env: Record<string, string | undefined>,
		logger?: ILogger
	): LocalComputeServerStore {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		if (!env.SELVA_AT_REST_KEY) {
			throw new Error(
				'Missing required env var: SELVA_AT_REST_KEY (32-byte hex or base64). ' +
					"Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
			);
		}
		return new LocalComputeServerStore(
			path.join(env.DATA_PATH, 'compute.config.json'),
			decodeSecretKey(env.SELVA_AT_REST_KEY),
			logger
		);
	}

	private readonly logger: ILogger;

	constructor(
		private readonly configFilePath: string,
		private readonly secretKey: Buffer,
		logger?: ILogger
	) {
		this.logger = logger ?? new NoopLogger();
	}

	private async readAll(): Promise<OnDiskShape> {
		const raw = await readJsonFile<OnDiskShape>(this.configFilePath, empty());
		return {
			servers: raw.servers ?? [],
			defaultServerId: raw.defaultServerId,
			orgDefaults: raw.orgDefaults ?? {}
		};
	}

	/**
	 * Tolerant per-row decrypt: a row that fails to authenticate under the
	 * current `SELVA_AT_REST_KEY` comes back with `apiKey: undefined` and a
	 * logged warning, rather than failing the whole read — the page keeps
	 * rendering, and a solve against that server fails later when
	 * Rhino.Compute rejects the missing key. `verifySecrets()` is the strict
	 * counterpart for boot time.
	 *
	 * Plaintext-on-disk still hard-fails: the store never writes plaintext
	 * (every write goes through `encryptApiKeys`), so seeing it means someone
	 * hand-edited the file with a real secret exposed — surface that loudly.
	 */
	private decryptApiKeys(servers: ComputeServerConfig[]): ComputeServerConfig[] {
		return servers.map((s) => {
			if (!s.apiKey) return s;
			if (!isEncryptedSecret(s.apiKey)) {
				throw new Error(
					`compute.config.json contains an unencrypted apiKey for server "${s.label}" (${s.id}). ` +
						'Re-enter the key via /admin/compute so it is stored encrypted.'
				);
			}
			try {
				return { ...s, apiKey: decryptSecret(s.apiKey, this.secretKey) };
			} catch (cause) {
				this.logger.warn(
					'Could not decrypt apiKey: the stored ciphertext does not match the current SELVA_AT_REST_KEY. ' +
						'This server is returned without an apiKey and solves against it will fail. ' +
						'Re-enter the key via /admin/compute, or restore the original SELVA_AT_REST_KEY.',
					{
						component: 'selva',
						serverLabel: s.label,
						serverId: s.id,
						err: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)
					}
				);
				return { ...s, apiKey: undefined };
			}
		});
	}

	/**
	 * Boot-time integrity check: attempts to decrypt every server's `apiKey`
	 * and returns a report instead of throwing — the caller decides what to do
	 * (refuse boot, log and degrade, etc). Call from `hooks.server.ts` so a key
	 * mismatch fails loudly at deploy time, not as a blank page when a user
	 * first hits a route that loads compute config.
	 */
	async verifySecrets(): Promise<SecretVerificationReport> {
		const all = await this.readAll();
		const failures: SecretVerificationFailure[] = [];
		let plaintextFound = false;

		for (const s of all.servers) {
			if (!s.apiKey) continue;
			if (!isEncryptedSecret(s.apiKey)) {
				plaintextFound = true;
				failures.push({
					serverId: s.id,
					serverLabel: s.label,
					reason: 'plaintext_on_disk'
				});
				continue;
			}
			try {
				decryptSecret(s.apiKey, this.secretKey);
			} catch (cause) {
				failures.push({
					serverId: s.id,
					serverLabel: s.label,
					reason: 'key_mismatch',
					cause: cause instanceof Error ? cause.message : String(cause)
				});
			}
		}

		return { ok: failures.length === 0, failures, plaintextFound };
	}

	private encryptApiKeys(servers: ComputeServerConfig[]): ComputeServerConfig[] {
		return servers.map((s) => {
			if (!s.apiKey) return s;
			if (isEncryptedSecret(s.apiKey)) return s;
			return { ...s, apiKey: encryptSecret(s.apiKey, this.secretKey) };
		});
	}

	async getConfig(_ctx: RequestContext, opts: GetConfigOptions = {}): Promise<ComputeConfig> {
		const all = await this.readAll();
		const servers = opts.includeApiKeys
			? this.decryptApiKeys(all.servers)
			: all.servers.map((s) => ({ ...s, apiKey: undefined }));
		return {
			// `hasApiKey` reads the stored (still-encrypted) value, so presence is
			// reported without decrypting anything.
			servers: servers.map((s, i) => ({ ...s, hasApiKey: !!all.servers[i].apiKey })),
			defaultServerId: all.defaultServerId,
			orgDefaults: all.orgDefaults
		};
	}

	/**
	 * One server's decrypted key. The local store reads the whole file anyway, so
	 * this exists for interface parity with Supabase (where it saves a table scan
	 * plus N decrypts) — and it still avoids decrypting the other servers' keys.
	 */
	async getServerApiKey(_ctx: RequestContext, serverId: string): Promise<string | undefined> {
		const all = await this.readAll();
		const server = all.servers.find((s) => s.id === serverId);
		if (!server?.apiKey) return undefined;
		return this.decryptApiKeys([server])[0].apiKey;
	}

	async savePlatformServers(
		_ctx: RequestContext,
		servers: ComputeServerConfig[],
		defaultServerId: string | undefined
	): Promise<void> {
		const all = await this.readAll();
		const orgRows = all.servers.filter(isOrgServer);
		const platformRows = this.encryptApiKeys(servers.filter(isPlatformServer));

		await writeJsonFile<OnDiskShape>(this.configFilePath, {
			servers: [...platformRows, ...orgRows],
			defaultServerId,
			orgDefaults: all.orgDefaults
		});
	}

	async saveOrgServers(
		_ctx: RequestContext,
		orgId: string,
		servers: ComputeServerConfig[],
		defaultServerId?: string | null
	): Promise<void> {
		const all = await this.readAll();
		const platformRows = all.servers.filter(isPlatformServer);
		const otherOrgRows = all.servers.filter((s) => isOrgServer(s) && s.ownerOrgId !== orgId);
		const thisOrgRows = this.encryptApiKeys(
			servers
				.filter((_s): _s is ComputeServerConfig => true)
				.map((s) =>
					isOrgServer(s)
						? { ...s, ownerOrgId: orgId }
						: // Coerce — caller passed something with the wrong/missing scope.
							({ ...s, scope: 'org', ownerOrgId: orgId } as ComputeServerConfig)
				)
		);

		const orgDefaults = { ...(all.orgDefaults ?? {}) };
		if (defaultServerId === null) {
			delete orgDefaults[orgId];
		} else if (typeof defaultServerId === 'string') {
			orgDefaults[orgId] = defaultServerId;
		}

		await writeJsonFile<OnDiskShape>(this.configFilePath, {
			servers: [...platformRows, ...otherOrgRows, ...thisOrgRows],
			defaultServerId: all.defaultServerId,
			orgDefaults
		});
	}

	async setOrgDefault(_ctx: RequestContext, orgId: string, serverId: string | null): Promise<void> {
		const all = await this.readAll();
		const orgDefaults = { ...(all.orgDefaults ?? {}) };
		if (serverId === null) {
			delete orgDefaults[orgId];
		} else {
			orgDefaults[orgId] = serverId;
		}
		await writeJsonFile<OnDiskShape>(this.configFilePath, { ...all, orgDefaults });
	}

	async deleteByOrg(_ctx: RequestContext, orgId: string): Promise<void> {
		const all = await this.readAll();
		const remaining = all.servers.filter((s) => !(isOrgServer(s) && s.ownerOrgId === orgId));

		const cleaned: ComputeServerConfig[] = remaining.map((s) => {
			if (!isPlatformServer(s)) return s;
			if (s.sharedWith === 'all') return s;
			if (!s.sharedWith.includes(orgId)) return s;
			const next: PlatformComputeServer = {
				...s,
				sharedWith: s.sharedWith.filter((id) => id !== orgId)
			};
			return next;
		});

		const orgDefaults = { ...(all.orgDefaults ?? {}) };
		const hadDefault = orgId in orgDefaults;
		delete orgDefaults[orgId];

		const changed =
			cleaned.length !== all.servers.length ||
			hadDefault ||
			cleaned.some((c, i) => c !== all.servers[i]);
		if (!changed) return;

		await writeJsonFile<OnDiskShape>(this.configFilePath, {
			servers: cleaned,
			defaultServerId: all.defaultServerId,
			orgDefaults
		});
	}
}
