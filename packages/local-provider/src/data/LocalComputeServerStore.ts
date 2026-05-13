import * as path from 'node:path';
import {
	isOrgServer,
	isPlatformServer,
	type IComputeServerStore,
	type ComputeConfig,
	type ComputeServerConfig,
	type PlatformComputeServer,
	type RequestContext
} from '@selvajs/platform';
import { readJsonFile, writeJsonFile } from './fsJson.js';
import {
	decodeSecretKey,
	decryptSecret,
	encryptSecret,
	isEncryptedSecret
} from './secretCrypto.js';

/**
 * On-disk file shape. Single document holding *all* servers (platform +
 * org-private), the global `defaultServerId`, and the per-org
 * `orgDefaults` map. Spec §3.
 *
 * `apiKey` on disk is always an `enc:v1:<…>` envelope (AES-256-GCM); the
 * store decrypts on read so callers see plaintext.
 */
interface OnDiskShape {
	servers: ComputeServerConfig[];
	defaultServerId?: string;
	orgDefaults?: Record<string, string>;
}

const EMPTY: OnDiskShape = { servers: [], orgDefaults: {} };

/**
 * Result of {@link LocalComputeServerStore.verifySecrets}. One entry per
 * server whose `apiKey` couldn't be loaded:
 *  - `plaintext_on_disk` — the field exists but isn't an `enc:v1:` envelope.
 *    Either a hand-edit or a migration regression. Security-relevant.
 *  - `key_mismatch`     — envelope is valid but GCM auth tag verification
 *    fails under the current `SELVA_AT_REST_KEY`. The key was rotated or the
 *    data came from another deployment.
 */
export type SecretVerificationFailureReason = 'key_mismatch' | 'plaintext_on_disk';

export interface SecretVerificationFailure {
	serverId: string;
	serverLabel: string;
	reason: SecretVerificationFailureReason;
	/** Underlying error message for `key_mismatch`. Absent for plaintext. */
	cause?: string;
}

export interface SecretVerificationReport {
	ok: boolean;
	failures: SecretVerificationFailure[];
	/** True if at least one row holds an unencrypted apiKey on disk. */
	plaintextFound: boolean;
}

/**
 * Reads/writes compute.config.json. The file is re-read on every read call
 * so changes take effect without a restart.
 *
 * Mutation methods are scope-targeted (`savePlatformServers`,
 * `saveOrgServers`, `setOrgDefault`) — each preserves rows in the other
 * scopes untouched.
 */
export class LocalComputeServerStore implements IComputeServerStore {
	static fromEnv(env: Record<string, string | undefined>): LocalComputeServerStore {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		if (!env.SELVA_AT_REST_KEY) {
			throw new Error(
				'Missing required env var: SELVA_AT_REST_KEY (32-byte hex or base64). ' +
					"Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
			);
		}
		return new LocalComputeServerStore(
			path.join(env.DATA_PATH, 'compute.config.json'),
			decodeSecretKey(env.SELVA_AT_REST_KEY)
		);
	}

	constructor(
		private readonly configFilePath: string,
		private readonly secretKey: Buffer
	) {}

	private async readAll(): Promise<OnDiskShape> {
		const raw = await readJsonFile<OnDiskShape>(this.configFilePath, EMPTY);
		return {
			servers: raw.servers ?? [],
			defaultServerId: raw.defaultServerId,
			orgDefaults: raw.orgDefaults ?? {}
		};
	}

	/**
	 * Per-row tolerant decrypt. A row whose ciphertext can't be authenticated
	 * under the current `SELVA_AT_REST_KEY` is returned with `apiKey: undefined`
	 * and a warning logged once. The page that loaded the config keeps
	 * rendering; solves against that server will fail later when Rhino.Compute
	 * rejects the missing key.
	 *
	 * Boot-time `verifySecrets()` is the strict counterpart — call that from
	 * the app entrypoint to refuse to start when this state is detected.
	 *
	 * Plaintext-on-disk is still hard-fail. That state is never produced by
	 * the store itself (every write goes through `encryptApiKeys`), so seeing
	 * it means someone hand-edited the file with a real secret in plaintext —
	 * which is a security issue we should surface loudly, not paper over.
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
				console.warn(
					`[selva] Could not decrypt apiKey for compute server "${s.label}" (${s.id}). ` +
						'The stored ciphertext does not match the current SELVA_AT_REST_KEY. ' +
						'This server will be returned without an apiKey; solves against it will fail. ' +
						'Re-enter the key via /admin/compute, or restore the original SELVA_AT_REST_KEY. ' +
						'See docs/Troubleshooting.md.',
					cause
				);
				return { ...s, apiKey: undefined };
			}
		});
	}

	/**
	 * Boot-time integrity check. Reads every server row and attempts to
	 * decrypt each encrypted `apiKey`. Returns a structured report — does NOT
	 * throw. The caller decides what to do (refuse boot, log + degrade, etc.).
	 *
	 * Use this from app startup (`hooks.server.ts`) so a key mismatch fails
	 * loudly at deploy time instead of as a blank page when a user first hits
	 * a route that loads compute config.
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

	async getConfig(_ctx: RequestContext): Promise<ComputeConfig> {
		const all = await this.readAll();
		return {
			servers: this.decryptApiKeys(all.servers),
			defaultServerId: all.defaultServerId,
			orgDefaults: all.orgDefaults
		};
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
				.filter((s): s is ComputeServerConfig => true)
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

		// Drop org-private rows owned by this org.
		const remaining = all.servers.filter((s) => !(isOrgServer(s) && s.ownerOrgId === orgId));

		// Strip this org from any platform server's `sharedWith` allowlist.
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
