import { describe, expect, it } from 'vitest';
import type { ComputeConfig } from '../types.js';
import { scopeConfigToOrg } from '../utils.js';

describe('scopeConfigToOrg', () => {
	const server = (id: string, sharedWith: string[]) => ({
		id,
		scope: 'platform' as const,
		sharedWith,
		label: id,
		serverUrl: 'http://c'
	});

	it('drops an org default the org can no longer see', () => {
		const config: ComputeConfig = {
			servers: [server('hidden', ['other'])],
			orgDefaults: { acme: 'hidden' }
		};
		expect(scopeConfigToOrg(config, 'acme').orgDefaults).toEqual({});
	});

	it('keeps a visible default', () => {
		const config: ComputeConfig = {
			servers: [server('shared', ['acme'])],
			orgDefaults: { acme: 'shared' }
		};
		expect(scopeConfigToOrg(config, 'acme').orgDefaults).toEqual({ acme: 'shared' });
	});
});
