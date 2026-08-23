import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = 'enc:v1:';

/**
 * AES-256-GCM envelope for at-rest secrets (e.g. compute API keys).
 *
 * Wire format: `enc:v1:<base64(iv|tag|ciphertext)>`. The version prefix lets
 * a future migration to a new algorithm tell old and new envelopes apart.
 *
 * Defends against backup leaks, accidental file/DB sharing, and read-only
 * storage access — not against an attacker who also has the master key
 * (`SELVA_AT_REST_KEY` env var, process memory). This is encryption at rest,
 * not a secret manager.
 *
 * Pure `node:crypto`, no fs or DB coupling, so the local and Supabase
 * compute-server stores share this one implementation.
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
 * Decodes a `SELVA_AT_REST_KEY` env var into a 32-byte buffer (64-char hex or
 * base64, with or without padding). Throws on anything else so a
 * misconfigured key fails loudly at boot instead of silently producing
 * ciphertext nothing can decrypt.
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
 *  - `plaintext_on_disk` — the field exists but isn't an `enc:v1:` envelope:
 *    a hand-edit, a legacy row from before encryption, or a migration
 *    regression. Security-relevant.
 *  - `key_mismatch` — envelope is valid but GCM auth-tag verification fails
 *    under the current `SELVA_AT_REST_KEY`: the key was rotated, or the data
 *    came from another deployment.
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
