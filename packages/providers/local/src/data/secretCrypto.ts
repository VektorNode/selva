/**
 * At-rest secret crypto for the local provider.
 *
 * The implementation now lives in `@selvajs/platform` (`computeServer/secrets`)
 * so the local and Supabase compute-server stores share one AES-256-GCM
 * envelope. This module re-exports it to keep the local provider's internal
 * import paths stable.
 */
export {
	isEncryptedSecret,
	encryptSecret,
	decryptSecret,
	decodeSecretKey
} from '@selvajs/platform/computeServer';
