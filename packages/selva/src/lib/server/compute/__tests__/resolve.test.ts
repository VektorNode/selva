/**
 * `resolveServerForOrg` picks which Rhino.Compute instance an org's solve goes
 * to, and fetches that server's API key. Both halves are cross-tenant:
 *
 *   - Resolving to a server the org cannot see sends its geometry to another
 *     tenant's compute instance.
 *   - Fetching the wrong server's key hands out a credential.
 *
 * Nothing downstream re-checks either. The solve just succeeds against the
 * wrong host, which is why these are tested against a real store rather than
 * left to the pure resolver's own unit tests.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT, type ComputeServerConfig, type RequestContext } from '@selvajs/platform';
import { randomUUID } from 'node:crypto';
import { resolveServerForOrg, ComputeServerUnconfiguredError } from '../resolve.server.js';
import { freshProviders, seedAcme, seedOrg, type TestProviders } from '../../__tests__/fixtures.js';

let tp: TestProviders;

afterEach(async () => {
	await tp?.cleanup();
});

function platformServer(over: Partial<ComputeServerConfig> = {}): ComputeServerConfig {
	return {
		id: randomUUID(),
		label: 'Platform',
		serverUrl: 'https://platform.compute.test',
		scope: 'platform',
		sharedWith: 'all',
		...over
	} as ComputeServerConfig;
}

function orgServer(
	ownerOrgId: string,
	over: Partial<ComputeServerConfig> = {}
): ComputeServerConfig {
	return {
		id: randomUUID(),
		label: 'Org private',
		serverUrl: 'https://org.compute.test',
		scope: 'org',
		ownerOrgId,
		...over
	} as ComputeServerConfig;
}

/** An org-scoped ctx, as `hooks.server.ts` builds for a request acting in `orgId`. */
function ctxFor(orgId: string): RequestContext {
	return {
		userId: 'test-user',
		actingOrgId: orgId,
		platformPermissions: ['instance_admin'],
		orgPermissions: []
	};
}

describe('resolveServerForOrg', () => {
	it('throws ComputeServerUnconfiguredError when nothing is visible', async () => {
		tp = await freshProviders();
		const { acme } = await seedAcme(tp);

		await expect(
			resolveServerForOrg(ctxFor(acme.id), acme.id, tp.config.data.computeServer)
		).rejects.toBeInstanceOf(ComputeServerUnconfiguredError);
	});

	it('never resolves to another org private server', async () => {
		tp = await freshProviders();
		const { acme, alice } = await seedAcme(tp);
		const other = await seedOrg(tp, { name: 'Other Co', slug: 'other-co', ownerId: alice.id });

		// Only the *other* org has a server. Acme has none visible at all, so a
		// resolver that ignored ownership would happily hand back Other Co's.
		const theirs = orgServer(other.id);
		await tp.config.data.computeServer.saveOrgServers(SYSTEM_CONTEXT, other.id, [theirs]);

		await expect(
			resolveServerForOrg(ctxFor(acme.id), acme.id, tp.config.data.computeServer)
		).rejects.toBeInstanceOf(ComputeServerUnconfiguredError);
	});

	it('prefers the org default over the global default', async () => {
		tp = await freshProviders();
		const { acme } = await seedAcme(tp);

		const global = platformServer({ label: 'Global' });
		await tp.config.data.computeServer.savePlatformServers(SYSTEM_CONTEXT, [global], global.id);
		const mine = orgServer(acme.id, { label: 'Acme private' });
		await tp.config.data.computeServer.saveOrgServers(SYSTEM_CONTEXT, acme.id, [mine], mine.id);

		const picked = await resolveServerForOrg(
			ctxFor(acme.id),
			acme.id,
			tp.config.data.computeServer
		);
		expect(picked.id).toBe(mine.id);
	});

	it('falls back to the global default when the org has no override', async () => {
		tp = await freshProviders();
		const { acme } = await seedAcme(tp);

		const global = platformServer({ label: 'Global' });
		await tp.config.data.computeServer.savePlatformServers(SYSTEM_CONTEXT, [global], global.id);

		const picked = await resolveServerForOrg(
			ctxFor(acme.id),
			acme.id,
			tp.config.data.computeServer
		);
		expect(picked.id).toBe(global.id);
	});

	it('honours a definition pin that is visible to the org', async () => {
		tp = await freshProviders();
		const { acme } = await seedAcme(tp);

		const global = platformServer({ label: 'Global' });
		await tp.config.data.computeServer.savePlatformServers(SYSTEM_CONTEXT, [global], global.id);
		const pinned = orgServer(acme.id, { label: 'Pinned' });
		await tp.config.data.computeServer.saveOrgServers(SYSTEM_CONTEXT, acme.id, [pinned]);

		const picked = await resolveServerForOrg(
			ctxFor(acme.id),
			acme.id,
			tp.config.data.computeServer,
			{ definitionPin: pinned.id }
		);
		expect(picked.id).toBe(pinned.id);
	});

	it('ignores a pin pointing at a server the org cannot see', async () => {
		tp = await freshProviders();
		const { acme, alice } = await seedAcme(tp);
		const other = await seedOrg(tp, { name: 'Other Co', slug: 'other-co', ownerId: alice.id });

		const global = platformServer({ label: 'Global' });
		await tp.config.data.computeServer.savePlatformServers(SYSTEM_CONTEXT, [global], global.id);
		// A stale pin: the definition still references Other Co's private server,
		// e.g. after the definition was moved between orgs. Falling back to the
		// global default is correct; honouring the pin is a tenant crossing.
		const theirs = orgServer(other.id);
		await tp.config.data.computeServer.saveOrgServers(SYSTEM_CONTEXT, other.id, [theirs]);

		const picked = await resolveServerForOrg(
			ctxFor(acme.id),
			acme.id,
			tp.config.data.computeServer,
			{ definitionPin: theirs.id }
		);
		expect(picked.id).toBe(global.id);
	});

	it('loads the API key of the server that won, and only that one', async () => {
		tp = await freshProviders();
		const { acme } = await seedAcme(tp);

		// Two visible servers with different keys. Returning the wrong key is a
		// credential leak that no later step catches — the solve just fails at
		// Rhino.Compute, which reads as an outage rather than a bug.
		const global = platformServer({ label: 'Global', apiKey: 'global-key' });
		await tp.config.data.computeServer.savePlatformServers(SYSTEM_CONTEXT, [global], global.id);
		const mine = orgServer(acme.id, { label: 'Acme private', apiKey: 'acme-key' });
		await tp.config.data.computeServer.saveOrgServers(SYSTEM_CONTEXT, acme.id, [mine], mine.id);

		const picked = await resolveServerForOrg(
			ctxFor(acme.id),
			acme.id,
			tp.config.data.computeServer
		);
		expect(picked.id).toBe(mine.id);
		expect(picked.apiKey).toBe('acme-key');
	});

	it('leaves apiKey unset for a server with no key stored', async () => {
		tp = await freshProviders();
		const { acme } = await seedAcme(tp);

		const global = platformServer({ label: 'Global' });
		await tp.config.data.computeServer.savePlatformServers(SYSTEM_CONTEXT, [global], global.id);

		const picked = await resolveServerForOrg(
			ctxFor(acme.id),
			acme.id,
			tp.config.data.computeServer
		);
		expect(picked.apiKey).toBeUndefined();
	});
});
