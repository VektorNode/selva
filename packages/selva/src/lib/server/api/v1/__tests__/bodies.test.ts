/**
 * The body validators, where parsing can change meaning rather than just
 * reject. Most schemas here are plain field lists that need no test; these two
 * carry a distinction the parse could silently erase.
 */

import { describe, it, expect } from 'vitest';
import { OrgComputePatchBodySchema, SolveBodySchema } from '../bodies.js';

describe('OrgComputePatchBodySchema', () => {
	const server = { id: 'a', label: 'Prod', serverUrl: 'http://compute.local' };

	// `resolveApiKey` reads these three cases apart to decide whether to keep,
	// clear, or replace a stored credential. If the parse collapsed "omitted"
	// into `null`, every save that left the field out would wipe a live key —
	// and nothing else in the stack would notice.
	it('keeps omitted, null and set apiKey distinguishable', () => {
		const omitted = OrgComputePatchBodySchema.parse({ servers: [{ ...server }] }).servers[0];
		const cleared = OrgComputePatchBodySchema.parse({
			servers: [{ ...server, apiKey: null }]
		}).servers[0];
		const replaced = OrgComputePatchBodySchema.parse({
			servers: [{ ...server, apiKey: 'secret' }]
		}).servers[0];

		expect('apiKey' in omitted, 'omitted must not materialize as a key').toBe(false);
		expect(cleared.apiKey).toBeNull();
		expect(replaced.apiKey).toBe('secret');
	});

	it('leaves defaultServerId untouched when absent', () => {
		const parsed = OrgComputePatchBodySchema.parse({ servers: [] });
		// Absent means "leave the current default alone"; null means "clear it".
		expect('defaultServerId' in parsed).toBe(false);
		expect(OrgComputePatchBodySchema.parse({ servers: [], defaultServerId: null })).toHaveProperty(
			'defaultServerId',
			null
		);
	});

	it('rejects a server missing its id', () => {
		expect(
			OrgComputePatchBodySchema.safeParse({ servers: [{ label: 'x', serverUrl: 'y' }] }).success
		).toBe(false);
	});
});

describe('SolveBodySchema', () => {
	it('defaults an empty body to a live solve with no inputs', () => {
		expect(SolveBodySchema.parse({})).toEqual({ inputs: [], values: {}, channel: 'live' });
	});

	it('rejects a channel that is neither live nor draft', () => {
		expect(SolveBodySchema.safeParse({ channel: 'preview' }).success).toBe(false);
	});
});
