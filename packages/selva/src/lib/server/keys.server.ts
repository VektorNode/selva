import { env } from '#lib/server/env.js';
import { previousKey } from '@selvajs/platform/config';

/**
 * `SELVA_HMAC_KEY` signs new things; `SELVA_HMAC_KEY_PREVIOUS` is the key from
 * before the last `selva keys rotate hmac`, still accepted for what it signed
 * until `SELVA_HMAC_KEY_PREVIOUS_EXPIRES`. Read per call, so the overlap ends
 * on time in a process that never restarts.
 */
export function hmacKeys(): { current: string | undefined; previous: string | undefined } {
	return {
		current: env.SELVA_HMAC_KEY || undefined,
		previous: previousKey(env, 'SELVA_HMAC_KEY').key
	};
}
