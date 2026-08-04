import { fail } from '@sveltejs/kit';
import { hasPermission } from '@selvajs/platform';
import { flag } from '$lib/server/providers.server';
import { checkForUpdate } from '$lib/server/updateCheck.server';
import { readChannel, writeChannel } from '$lib/server/releaseChannel.server';
import { requirePermission } from '$lib/server/access.server';
import {
	SOLVE_DEADLINE_MS,
	RATE_LIMIT_WINDOW_MS,
	RATE_LIMIT_MAX_REQUESTS,
	MAX_GH_FILE_SIZE,
	MAX_IMAGE_FILE_SIZE,
	COMPUTE_REQUEST_MAX_BYTES,
	COMPUTE_RESPONSE_MAX_BYTES,
	REMOTE_DEFINITION_MAX_BYTES,
	REMOTE_DEFINITION_FETCH_TIMEOUT_MS,
	REMOTE_DEFINITION_CACHE_TTL_MS,
	COMPUTE_DEFINITION_CACHE_BYTES,
	COMPUTE_SOLVE_CACHE_BYTES
} from '$lib/server/computeLimits';
import pkg from '../../../../package.json';
import type { Actions, PageServerLoad } from './$types';

/**
 * System settings host the Update runner (`manage_updates`). Other panels
 * (platform-flag display, build/deploy metadata) are visible to anyone who
 * passed the layout-level `assertAnyPlatformPermission` gate.
 *
 * `version` comes from a build-time JSON import of this package's own
 * package.json — the runtime version IS the version we built with, and
 * after an admin update the new build embeds the new constant. No need to
 * shell out to `npm` or read node_modules at request time.
 */
export const load: PageServerLoad = async ({ locals, fetch }) => {
	const ctx = locals.ctx;
	const canManageUpdates = ctx ? hasPermission(ctx, 'manage_updates') : false;
	// The on-demand health check endpoint is instance_admin-only; gate the UI
	// to match so we don't show a button that 403s.
	const isInstanceAdmin = ctx ? hasPermission(ctx, 'instance_admin') : false;

	const flags = {
		ALLOW_CROSS_ORG_PUBLIC: flag('ALLOW_CROSS_ORG_PUBLIC'),
		ALLOW_ORG_COMPUTE_OVERRIDE: flag('ALLOW_ORG_COMPUTE_OVERRIDE'),
		ALLOW_ORG_CREATION: flag('ALLOW_ORG_CREATION'),
		ENABLE_PLATFORM_PROJECTS: flag('ENABLE_PLATFORM_PROJECTS'),
		ENABLE_SHARING: flag('ENABLE_SHARING')
	};

	// Resolved compute/upload limits (computeLimits.ts is the single source of
	// truth — each value here reflects the env override or its default). Surfaced
	// read-only so operators can see what's enforced without reading the .env.
	const limits = {
		SOLVE_DEADLINE_MS,
		RATE_LIMIT_WINDOW_MS,
		RATE_LIMIT_MAX_REQUESTS,
		MAX_GH_FILE_SIZE,
		MAX_IMAGE_FILE_SIZE,
		COMPUTE_REQUEST_MAX_BYTES,
		COMPUTE_RESPONSE_MAX_BYTES,
		REMOTE_DEFINITION_MAX_BYTES,
		REMOTE_DEFINITION_FETCH_TIMEOUT_MS,
		REMOTE_DEFINITION_CACHE_TTL_MS,
		COMPUTE_DEFINITION_CACHE_BYTES,
		COMPUTE_SOLVE_CACHE_BYTES
	};

	// The persisted release channel drives which dist-tag the update check (and
	// the runner) targets. Read it regardless of permission so the panel can show
	// it; only managers can change it via the action below.
	const channel = readChannel();

	// Only operators who can run updates need the registry check — skip the
	// npm round-trip for everyone else.
	const update = canManageUpdates
		? await checkForUpdate(fetch, channel)
		: {
				channel,
				current: null,
				latest: null,
				updateAvailable: false,
				nodeCompatibility: {
					compatible: null,
					required: null,
					running: process.versions.node
				}
			};

	return {
		canManageUpdates,
		isInstanceAdmin,
		flags,
		limits,
		version: pkg.version,
		channel,
		update
	};
};

export const actions: Actions = {
	// Persist the release channel. Switch-only: this does NOT trigger an update —
	// the operator then uses the Update runner to install from the chosen channel.
	setChannel: async ({ request, locals }) => {
		requirePermission(locals, 'manage_updates');
		const data = await request.formData();
		const channel = data.get('channel');
		if (channel !== 'stable' && channel !== 'beta') {
			return fail(400, { error: 'Invalid channel.' });
		}
		try {
			writeChannel(channel);
		} catch (e) {
			return fail(500, {
				error: `Could not persist the channel: ${e instanceof Error ? e.message : 'unknown error'}`
			});
		}
		return { channel };
	}
};
