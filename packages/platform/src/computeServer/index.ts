export * from './public.js';
// Server-only: import these from `@selvajs/platform/computeServer`.
export {
	isEncryptedSecret,
	isLegacyEnvelope,
	isUnknownEnvelope,
	encryptSecret,
	decryptSecret,
	decryptWithKeys,
	decodeSecretKey,
	readAtRestKeys
} from './secrets.js';
export type { SecretBinding } from './secrets.js';
export { parseKey32 } from './key32.js';
