import { getLogger } from '../utils/logger';

/**
 * Debug-gated log. Every transport module routes through this rather than calling the logger
 * directly, so `config.debug` is the single switch for the whole request path.
 */
export function log(message: string, debug?: boolean): void {
	if (debug) getLogger().debug(message);
}
