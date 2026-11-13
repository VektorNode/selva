/**
 * An empty instance goes to a sign-in that proves it is the operator: the
 * pinned email, or a browser that opened the setup link. Anything else would
 * hand it to whoever reached the host first.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedUser,
	setEnv,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import {
	bootstrapUserSession,
	identifyWithSetupProof,
	shouldBootstrapAdmin,
	wireHeaderAuthBootstrap
} from '../auth-bootstrap.server.js';

let tp: TestProviders | null = null;
afterEach(async () => {
	await tp?.cleanup();
	tp = null;
	await setEnv('BOOTSTRAP_INSTANCE_ADMIN_EMAIL', undefined);
});

describe('shouldBootstrapAdmin', () => {
	it.each([
		['unpinned, no setup link', 'a@x.test', undefined, false, false],
		['unpinned, setup link', 'a@x.test', undefined, true, true],
		['pinned, matching email', 'Op@X.test', 'op@x.test', false, true],
		['pinned, other email', 'a@x.test', 'op@x.test', true, false],
		['pinned, no email', undefined, 'op@x.test', true, false]
	])('%s', (_, email, pinned, proven, expected) => {
		expect(shouldBootstrapAdmin(email, pinned, proven)).toBe(expected);
	});
});

describe('bootstrapUserSession on an empty instance', () => {
	it('gives an unpinned instance only to a sign-in carrying the setup link', async () => {
		tp = await freshProviders();
		const first = await seedUser(tp, 'first@x.test');
		const operator = await seedUser(tp, 'operator@x.test');

		await bootstrapUserSession({ id: first.id, email: first.email }, false);
		expect(await tp.config.data.permissions.hasInstanceAdmin(SYSTEM_CONTEXT)).toBe(false);

		await bootstrapUserSession({ id: operator.id, email: operator.email }, true);
		expect(await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, operator.id)).toContain(
			'instance_admin'
		);
	});

	it("hands the proxy allowlist policy the request's setup proof", async () => {
		tp = await freshProviders();
		type Policy = (p: { upn: string; email: string | undefined }) => Promise<boolean>;
		let policy: Policy | null = null;
		Object.assign(tp.config.auth, {
			proxyAuth: {},
			setBootstrapAllowlistPolicy: (p: Policy) => (policy = p)
		});
		wireHeaderAuthBootstrap();
		const visit = { upn: 'someone@x.test', email: undefined };

		expect(await identifyWithSetupProof(false, () => policy!(visit))).toBe(false);
		expect(await identifyWithSetupProof(true, () => policy!(visit))).toBe(true);
	});

	it('gives a pinned instance to the pinned email without the link', async () => {
		await setEnv('BOOTSTRAP_INSTANCE_ADMIN_EMAIL', 'operator@x.test');
		tp = await freshProviders();
		const operator = await seedUser(tp, 'operator@x.test');

		await bootstrapUserSession({ id: operator.id, email: operator.email }, false);
		expect(await tp.config.data.permissions.getFor(SYSTEM_CONTEXT, operator.id)).toContain(
			'instance_admin'
		);
	});
});
