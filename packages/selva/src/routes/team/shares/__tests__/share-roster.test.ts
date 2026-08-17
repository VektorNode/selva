/**
 * Finding 9 — share links survive every form of offboarding, and until this
 * page existed there was no way to find them.
 *
 * A share link is a bearer credential: the URL is the whole authentication.
 * The only listing was per-definition and required edit rights on that
 * definition, so the real offboarding runbook was "enumerate every definition
 * in every project the leaver could edit, and inspect each one by hand". At
 * any scale that does not happen.
 *
 * The spec's stance (§10 — links the user minted are unaffected) is defensible
 * only with this roster: killing a departing colleague's client demo punishes
 * the client, not the leaver. Seeing the list is what makes the choice possible.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	freshProviders,
	seedAcme,
	seedDefinition,
	seedShareLink,
	actAs,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { load, type ShareRow } from '../+page.server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

// `PageServerLoad` widens its return, so name the shape the page actually gets.
type LoadResult = { rows: ShareRow[] };

async function runLoad(locals: unknown): Promise<LoadResult> {
	return (await load({ locals } as Parameters<typeof load>[0])) as LoadResult;
}

/** Catch the redirect/error `load` throws so a test can assert on its status. */
async function loadStatus(locals: unknown): Promise<number> {
	try {
		await runLoad(locals);
		return 200;
	} catch (err) {
		return (err as { status: number }).status;
	}
}

describe('/team/shares roster', () => {
	it('lists links across every definition in the org, naming minter and parents', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, acmeOrg } = await seedAcme(tp);
		const def = await seedDefinition(tp, {
			projectId: acmeOrg.id,
			ownerId: alice.id,
			displayName: 'Facade Study'
		});
		await seedShareLink(tp, { definitionId: def.record.guid, createdBy: alice.id });

		const locals = await actAs(tp, alice.id);
		const { rows } = await runLoad(locals);

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			definitionId: def.record.guid,
			definitionName: 'Facade Study',
			projectId: acmeOrg.id,
			createdBy: alice.id
		});
	});

	it('never ships tokenHash to the browser', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, acmeOrg } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: acmeOrg.id, ownerId: alice.id });
		await seedShareLink(tp, { definitionId: def.record.guid, createdBy: alice.id });

		const locals = await actAs(tp, alice.id);
		const { rows } = await runLoad(locals);

		// The roster spans every definition in the tenant, so a careless
		// serialization here would leak every credential digest at once.
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) expect(row).not.toHaveProperty('tokenHash');
	});

	it('excludes revoked links', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, acmeOrg } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: acmeOrg.id, ownerId: alice.id });
		const { link } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id
		});
		await seedShareLink(tp, { definitionId: def.record.guid, createdBy: alice.id });

		const locals = await actAs(tp, alice.id);
		await tp.config.data.shareLinks.revoke(locals.ctx!, link.id);

		const { rows } = await runLoad(locals);
		expect(rows.map((r) => r.id)).not.toContain(link.id);
		expect(rows).toHaveLength(1);
	});

	it('refuses a member without manage_org_members', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: true } });
		const { alice, bob, acmeOrg } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: acmeOrg.id, ownerId: alice.id });
		await seedShareLink(tp, { definitionId: def.record.guid, createdBy: alice.id });

		// Bob is a plain member — enumerating every credential in the tenant is
		// not his to do, even though he can see this org's public projects.
		const locals = await actAs(tp, bob.id);
		expect(await loadStatus(locals)).toBe(303);
	});

	it('404s when sharing is disabled instance-wide', async () => {
		tp = await freshProviders({ flags: { ENABLE_SHARING: false } });
		const { alice } = await seedAcme(tp);

		const locals = await actAs(tp, alice.id);
		expect(await loadStatus(locals)).toBe(404);
	});
});
