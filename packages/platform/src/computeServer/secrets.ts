import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = 'enc:v1:';

/**
 * AES-256-GCM envelope for at-rest secrets (e.g. compute API keys).
 *
 * Wire format: `enc:v1:<base64(iv|tag|ciphertext)>`. The version prefix lets
 * us migrate to a new algorithm later without ambiguity. Plaintext never sits
 * at rest — on disk (local provider) or in the DB (Supabase provider).
 *
 * Security model: defends against backup leaks, accidental file/DB sharing,
 * and read-only storage access. An attacker with both the stored ciphertext
 * *and* the master key (`SELVA_AT_REST_KEY` env var, process memory) can still
 * decrypt — this is encryption at rest, not a secret manager.
 *
 * Provider-agnostic: pure `node:crypto`, no fs or DB coupling, so both the
 * local and Supabase compute-server stores share this one implementation.
 */

export function isEncryptedSecret(value: string): boolean {
	return value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string, key: Buffer): string {
	if (key.length !== 32) {
		throw new Error(`Secret key must be 32 bytes; got ${key.length}`);
	}
	if (isEncryptedSecret(plaintext)) {
		throw new Error('Refusing to encrypt a value that is already encrypted');
	}
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGO, key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(envelope: string, key: Buffer): string {
	if (key.length !== 32) {
		throw new Error(`Secret key must be 32 bytes; got ${key.length}`);
	}
	if (!isEncryptedSecret(envelope)) {
		throw new Error('Value is not an encrypted secret envelope');
	}
	const buf = Buffer.from(envelope.slice(PREFIX.length), 'base64');
	const iv = buf.subarray(0, IV_BYTES);
	const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
	const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
	const decipher = createDecipheriv(ALGO, key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Decode a `SELVA_AT_REST_KEY` env var into a 32-byte buffer. Accepts either
 * 64-char hex or base64 (with or without padding). Throws on anything else
 * so misconfiguration fails loudly at boot rather than silently producing
 * an undecryptable value.
 */
export function decodeSecretKey(raw: string): Buffer {
	if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
	const buf = Buffer.from(raw, 'base64');
	if (buf.length === 32) return buf;
	throw new Error(
		'SELVA_AT_REST_KEY must be 32 bytes encoded as 64-char hex or base64. ' +
			"Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
	);
}

/**
 * Result of a compute-server store's `verifySecrets()`. One `failures` entry
 * per server whose `apiKey` couldn't be loaded:
 *  - `plaintext_on_disk` — the field exists but isn't an `enc:v1:` envelope.
 *    Either a hand-edit, a legacy row from before encryption, or a migration
 *    regression. Security-relevant.
 *  - `key_mismatch`      — envelope is valid but GCM auth-tag verification
 *    fails under the current `SELVA_AT_REST_KEY`. The key was rotated or the
 *    data came from another deployment.
 *
 * Storage-agnostic (`plaintext_on_disk` reads "plaintext at rest" for both the
 * file- and DB-backed stores) so boot health can treat every provider alike.
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
	/** True if at least one row holds an unencrypted apiKey at rest. */
	plaintextFound: boolean;
}
