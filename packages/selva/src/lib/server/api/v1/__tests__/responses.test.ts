/**
 * The response schemas exist for one reason: a stored record carries a
 * credential next to the fields a client legitimately reads, and the handlers
 * used to remove it by destructuring. That worked until someone edited the line
 * away or added a field to the stored type — neither of which fails a build.
 *
 * These assert the property that replaced it: **the credential cannot get
 * through even when it is present on the input.**
 */

import { describe, it, expect } from 'vitest';
import {
	ShareLinkResponseSchema,
	InviteResponseSchema,
	OrgComputeServerResponseSchema,
	OrgComputeResponseSchema
} from '../responses.js';

describe('secrets cannot reach a client', () => {
	it('drops a share link tokenHash', () => {
		const parsed = ShareLinkResponseSchema.parse({
			id: 'l1',
			definitionId: 'd1',
			channel: 'live',
			tokenHash: 'HMAC-DO-NOT-PUBLISH',
			createdBy: 'u1',
			createdAt: '2026-01-01T00:00:00Z',
			allowSolve: true,
			solveCount: 0,
			hasToken: true
		});

		expect(parsed).not.toHaveProperty('tokenHash');
		expect(JSON.stringify(parsed)).not.toContain('HMAC-DO-NOT-PUBLISH');
		expect(parsed.hasToken).toBe(true);
	});

	it('drops an invite tokenHash', () => {
		const parsed = InviteResponseSchema.parse({
			id: 'i1',
			tokenHash: 'HMAC-DO-NOT-PUBLISH',
			email: 'someone@example.com',
			orgId: 'o1',
			orgRole: 'member',
			orgPermissions: [],
			invitedBy: 'u1',
			createdAt: '2026-01-01T00:00:00Z',
			expiresAt: '2026-01-08T00:00:00Z'
		});

		expect(parsed).not.toHaveProperty('tokenHash');
		expect(JSON.stringify(parsed)).not.toContain('HMAC-DO-NOT-PUBLISH');
	});

	it('drops a compute server apiKey but keeps hasApiKey', () => {
		const parsed = OrgComputeServerResponseSchema.parse({
			id: 's1',
			label: 'Prod',
			serverUrl: 'http://compute.local',
			scope: 'org',
			ownerOrgId: 'o1',
			apiKey: 'LIVE-RHINO-COMPUTE-KEY',
			hasApiKey: true
		});

		expect(parsed).not.toHaveProperty('apiKey');
		expect(JSON.stringify(parsed)).not.toContain('LIVE-RHINO-COMPUTE-KEY');
		expect(parsed.hasApiKey).toBe(true);
	});

	it('drops an apiKey nested inside the org compute payload', () => {
		// The nested case is the one a hand-written strip is most likely to miss:
		// the outer object looks clean while a server row still carries the key.
		const parsed = OrgComputeResponseSchema.parse({
			servers: [
				{
					id: 's1',
					label: 'Prod',
					serverUrl: 'http://compute.local',
					scope: 'org',
					ownerOrgId: 'o1',
					apiKey: 'LIVE-RHINO-COMPUTE-KEY',
					hasApiKey: true
				}
			],
			defaultServerId: null,
			globalDefaultServerId: null,
			catalog: []
		});

		expect(JSON.stringify(parsed)).not.toContain('LIVE-RHINO-COMPUTE-KEY');
	});

	it('drops a field added to the stored type but not to the schema', () => {
		// The regression this class of bug actually takes: someone adds a column,
		// and every response built from that record starts carrying it.
		const parsed = ShareLinkResponseSchema.parse({
			id: 'l1',
			definitionId: 'd1',
			channel: 'live',
			createdBy: 'u1',
			createdAt: '2026-01-01T00:00:00Z',
			allowSolve: true,
			solveCount: 0,
			hasToken: true,
			internalAuditNote: 'added later, never meant to be public'
		});

		expect(parsed).not.toHaveProperty('internalAuditNote');
	});
});
