import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { trimTrailing } from '../utils/trim.js';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX_V1 = 'enc:v1:';
const PREFIX_V2 = 'enc:v2:';

export function isEncryptedSecret(value: string): boolean {
	return value.startsWith(PREFIX_V1) || value.startsWith(PREFIX_V2);
}

/**
 * AES-256-GCM envelope for at-rest secrets (e.g. compute API keys).
 *
 * Wire format: `enc:v2:<base64(iv|tag|ciphertext)>`. `v2` authenticates the
 * record the secret belongs to as AAD, so ciphertext copied onto another record
 * fails to decrypt instead of handing the plaintext to that record's URL.
 * `enc:v1:` envelopes have no AAD and still read: a store rewrites them as `v2`
 * on its next save.
 *
 * Defends against backup leaks, accidental file/DB sharing, and read-only
 * storage access — not against an attacker who also has the master key
 * (`SELVA_AT_REST_KEY` env var, process memory). This is encryption at rest,
 * not a secret manager.
 *
 * Pure `node:crypto`, no fs or DB coupling, so the local and Supabase
 * compute-server stores share this one implementation.
 *
 * Pass `aad` to bind the secret to its record. {@link decryptSecret} then needs the
 * same value.
 */
export function encryptSecret(plaintext: string, key: Buffer, aad?: string): string {
	if (key.length !== 32) {
		throw new Error(`Secret key must be 32 bytes; got ${key.length}`);
	}
	if (isEncryptedSecret(plaintext)) {
		throw new Error('Refusing to encrypt a value that is already encrypted');
	}
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGO, key, iv);
	if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	const prefix = aad === undefined ? PREFIX_V1 : PREFIX_V2;
	return prefix + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** `aad` is ignored for an `enc:v1:` envelope and required for an `enc:v2:` one. */
export function decryptSecret(envelope: string, key: Buffer, aad?: string): string {
	if (key.length !== 32) {
		throw new Error(`Secret key must be 32 bytes; got ${key.length}`);
	}
	if (!isEncryptedSecret(envelope)) {
		throw new Error('Value is not an encrypted secret envelope');
	}
	const bound = envelope.startsWith(PREFIX_V2);
	if (bound && aad === undefined) {
		throw new Error('This secret is bound to a record: pass its id');
	}
	const buf = Buffer.from(envelope.slice(PREFIX_V2.length), 'base64');
	const iv = buf.subarray(0, IV_BYTES);
	const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
	const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
	const decipher = createDecipheriv(ALGO, key, iv);
	decipher.setAuthTag(tag);
	if (bound) decipher.setAAD(Buffer.from(aad as string, 'utf8'));
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Decodes a `SELVA_AT_REST_KEY` env var into a 32-byte buffer (64-char hex or
 * base64, with or without padding). Throws on anything else so a
 * misconfigured key fails loudly at boot instead of silently producing
 * ciphertext nothing can decrypt.
 */
export function decodeSecretKey(raw: string): Buffer {
	const key = raw.trim();
	if (/^[0-9a-fA-F]{64}$/.test(key)) return Buffer.from(key, 'hex');
	// `Buffer.from` skips what it can't decode, so only a round trip proves the
	// whole string was base64 rather than 32 bytes of it.
	const buf = Buffer.from(key, 'base64');
	if (buf.length === 32 && trimTrailing(buf.toString('base64'), '=') === trimTrailing(key, '=')) {
		return buf;
	}
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
	/** Rows only SELVA_AT_REST_KEY_PREVIOUS opens. Drop the previous key once this is 0. */
	onPreviousKey?: number;
}

/**
 * {@link decryptSecret} under each key in turn, current first. AES-GCM
 * authenticates, so a wrong key fails rather than returning garbage, and trying
 * the next one is safe. `keyIndex` above 0 means the caller should re-encrypt
 * under `keys[0]`.
 */
export function decryptWithKeys(
	envelope: string,
	keys: readonly Buffer[],
	aad?: string
): { plaintext: string; keyIndex: number } {
	let lastError: unknown;
	for (const [keyIndex, key] of keys.entries()) {
		try {
			return { plaintext: decryptSecret(envelope, key, aad), keyIndex };
		} catch (err) {
			lastError = err;
		}
	}
	throw lastError ?? new Error('No key to decrypt with');
}
