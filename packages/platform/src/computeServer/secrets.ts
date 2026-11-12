import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { parseKey32 } from './key32.js';
import { previousKey } from '../config/previous-key.js';
import type { EnvRecord } from '../config/resolve.js';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX_V1 = 'enc:v1:';
const PREFIX_V2 = 'enc:v2:';
const PREFIX_V3 = 'enc:v3:';
// Every version prefix has this length.
const PREFIX_LENGTH = PREFIX_V1.length;

/** The record a secret belongs to, and the URL the secret is sent to. */
export interface SecretBinding {
	id: string;
	url: string;
}

export function isEncryptedSecret(value: string): boolean {
	return isLegacyEnvelope(value) || value.startsWith(PREFIX_V3);
}

/**
 * An `enc:v1:` or `enc:v2:` envelope: sealed without a {@link SecretBinding}, so it
 * still opens after its record's URL changes. Stores re-seal these.
 */
export function isLegacyEnvelope(value: string): boolean {
	return value.startsWith(PREFIX_V1) || value.startsWith(PREFIX_V2);
}

/**
 * An `enc:v<n>:` envelope this build cannot open: a newer Selva sealed it, and this
 * one runs after a downgrade. It is ciphertext, so it must never be reported or
 * used as a plaintext key.
 */
export function isUnknownEnvelope(value: string): boolean {
	return /^enc:v\d+:/.test(value) && !isEncryptedSecret(value);
}

// JSON, so no two id/url pairs encode alike: `["a:b","c"]` is not `["a","b:c"]`.
function bindingAad({ id, url }: SecretBinding): Buffer {
	return Buffer.from(JSON.stringify([id, url]), 'utf8');
}

/**
 * AES-256-GCM envelope for at-rest secrets (e.g. compute API keys):
 * `enc:v<n>:<base64(iv|tag|ciphertext)>`. What `aad` is picks the version, and
 * the version says what GCM authenticates besides the ciphertext:
 *  - a {@link SecretBinding} gives `v3`: the record's id and URL. Ciphertext copied
 *    onto another record, or a record pointed at another host, fails to decrypt
 *    instead of handing the plaintext to that host.
 *  - a string gives `v2`: that string, which stores set to the record's id.
 *  - nothing gives `v1`: nothing.
 *
 * Defends against backup leaks, accidental file/DB sharing, and read-only
 * storage access — not against an attacker who also has the master key
 * (`SELVA_AT_REST_KEY` env var, process memory). This is encryption at rest,
 * not a secret manager.
 *
 * Pure `node:crypto`, no fs or DB coupling, so the local and Supabase
 * compute-server stores share this one implementation.
 */
export function encryptSecret(
	plaintext: string,
	key: Buffer,
	aad?: string | SecretBinding
): string {
	if (key.length !== 32) {
		throw new Error(`Secret key must be 32 bytes; got ${key.length}`);
	}
	if (isEncryptedSecret(plaintext)) {
		throw new Error('Refusing to encrypt a value that is already encrypted');
	}
	const [prefix, aadBytes] =
		aad === undefined
			? [PREFIX_V1, undefined]
			: typeof aad === 'string'
				? [PREFIX_V2, Buffer.from(aad, 'utf8')]
				: [PREFIX_V3, bindingAad(aad)];
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGO, key, iv);
	if (aadBytes) cipher.setAAD(aadBytes);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return prefix + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function aadToOpen(envelope: string, aad: string | SecretBinding | undefined): Buffer | undefined {
	if (envelope.startsWith(PREFIX_V1)) return undefined;
	if (envelope.startsWith(PREFIX_V2)) {
		if (aad === undefined) throw new Error('This secret is bound to a record: pass its id');
		return Buffer.from(typeof aad === 'string' ? aad : aad.id, 'utf8');
	}
	if (aad === undefined || typeof aad === 'string') {
		throw new Error('This secret is bound to a record and its URL: pass both');
	}
	return bindingAad(aad);
}

/**
 * `aad` is ignored for `v1`. `v2` takes the string it was sealed with, or a
 * binding's `id`; `v3` needs the binding.
 */
export function decryptSecret(envelope: string, key: Buffer, aad?: string | SecretBinding): string {
	if (key.length !== 32) {
		throw new Error(`Secret key must be 32 bytes; got ${key.length}`);
	}
	if (!isEncryptedSecret(envelope)) {
		throw new Error('Value is not an encrypted secret envelope');
	}
	const aadBytes = aadToOpen(envelope, aad);
	const buf = Buffer.from(envelope.slice(PREFIX_LENGTH), 'base64');
	if (buf.length < IV_BYTES + TAG_BYTES) {
		throw new Error('Encrypted secret is shorter than its IV and tag');
	}
	const iv = buf.subarray(0, IV_BYTES);
	const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
	const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
	// Pinned: without it Node accepts a truncated tag, down to 4 bytes.
	const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
	decipher.setAuthTag(tag);
	if (aadBytes) decipher.setAAD(aadBytes);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

const GENERATE_HINT =
	"Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";

/**
 * Decodes a `SELVA_AT_REST_KEY` env var into a 32-byte buffer (64-char hex or
 * base64, with or without padding). Throws on anything else so a
 * misconfigured key fails loudly at boot instead of silently producing
 * ciphertext nothing can decrypt.
 */
export function decodeSecretKey(raw: string): Buffer {
	const key = parseKey32(raw);
	if (key) return key;
	throw new Error(
		`SELVA_AT_REST_KEY must be 32 bytes encoded as 64-char hex or base64. ${GENERATE_HINT}`
	);
}

/**
 * `SELVA_AT_REST_KEY`, plus `SELVA_AT_REST_KEY_PREVIOUS` while it is within its
 * deadline. Throws when the current key is missing or malformed.
 */
export function readAtRestKeys(env: EnvRecord): { current: Buffer; previous?: Buffer } {
	if (!env.SELVA_AT_REST_KEY) {
		throw new Error(
			`Missing required env var: SELVA_AT_REST_KEY (32-byte hex or base64). ${GENERATE_HINT}`
		);
	}
	const current = decodeSecretKey(env.SELVA_AT_REST_KEY);
	const previous = previousKey(env, 'SELVA_AT_REST_KEY').key;
	return previous ? { current, previous: decodeSecretKey(previous) } : { current };
}

/**
 * Result of a compute-server store's `verifySecrets()`. One `failures` entry
 * per server whose `apiKey` couldn't be loaded:
 *  - `plaintext_on_disk` — the field exists but isn't an `enc:` envelope:
 *    a hand-edit, a legacy row from before encryption, or a migration
 *    regression. Security-relevant.
 *  - `key_mismatch` — envelope is valid but GCM auth-tag verification fails
 *    under the current `SELVA_AT_REST_KEY`: the key was rotated, or the data
 *    came from another deployment.
 *  - `unknown_envelope` — an `enc:v<n>:` envelope from a newer Selva than the
 *    one running ({@link isUnknownEnvelope}): the app was downgraded.
 */
export type SecretVerificationFailureReason =
	'key_mismatch' | 'plaintext_on_disk' | 'unknown_envelope';

export interface SecretVerificationFailure {
	serverId: string;
	serverLabel: string;
	reason: SecretVerificationFailureReason;
	/** Underlying error message for `key_mismatch`. Absent otherwise. */
	cause?: string;
}

export interface SecretVerificationReport {
	ok: boolean;
	failures: SecretVerificationFailure[];
	/** True if at least one row holds an unencrypted apiKey at rest. */
	plaintextFound: boolean;
	/** Rows only SELVA_AT_REST_KEY_PREVIOUS opens. Drop the previous key once this is 0. */
	onPreviousKey?: number;
	/**
	 * Rows in a {@link isLegacyEnvelope legacy envelope}, which still opens after the
	 * server's URL changes. `reencryptSecrets` re-seals them. Absent when there are none.
	 */
	legacyEnvelopes?: number;
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
	aad?: string | SecretBinding
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
