import { ComputeError, ErrorCodes } from '@selvajs/compute/core';
import { ComputeServerStats } from '@selvajs/compute/grasshopper';

type OpenedStats =
	| { stats: ComputeServerStats; misconfigured?: undefined }
	| { stats?: undefined; misconfigured: string };

/**
 * `ComputeServerStats` for a stored server. An unusable stored URL or key is the operator's to fix,
 * and the admin pages must show it rather than fail: it arrives as `misconfigured`, a message that
 * quotes neither the key nor the URL's credentials.
 */
export function openServerStats(serverUrl: string, apiKey: string | undefined): OpenedStats {
	try {
		return { stats: new ComputeServerStats(serverUrl, apiKey) };
	} catch (err) {
		if (err instanceof ComputeError && err.code === ErrorCodes.INVALID_CONFIG) {
			return { misconfigured: err.message };
		}
		throw err;
	}
}
