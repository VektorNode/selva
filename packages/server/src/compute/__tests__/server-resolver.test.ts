import { describe, it, expect, vi } from 'vitest';
import { SYSTEM_CONTEXT, type ComputeConfig, type RequestContext } from '@selvajs/platform';
import { createServerResolver } from '../resolve-server.js';

const server = {
	id: 'srv-1',
	label: 'Platform',
	serverUrl: 'https://platform.compute.test',
	scope: 'platform',
	sharedWith: 'all'
} as ComputeConfig['servers'][number];

function store() {
	return {
		getConfig: vi.fn(async (): Promise<ComputeConfig> => ({
			servers: [server],
			defaultServerId: server.id
		})),
		getServerApiKey: vi.fn(async () => 'key')
	} as never as Parameters<ReturnType<typeof createServerResolver>['resolve']>[2] & {
		getConfig: ReturnType<typeof vi.fn>;
	};
}

const user = (userId: string, platformPermissions: string[] = []) =>
	({
		userId,
		actingOrgId: 'org-a',
		platformPermissions,
		orgPermissions: []
	}) as never as RequestContext;

describe('createServerResolver', () => {
	it('answers one caller from its first read until forget', async () => {
		const resolver = createServerResolver();
		const s = store();
		await resolver.resolve(SYSTEM_CONTEXT, 'org-a', s);
		await resolver.resolve(SYSTEM_CONTEXT, 'org-a', s);
		expect(s.getConfig).toHaveBeenCalledTimes(1);
		resolver.forget();
		await resolver.resolve(SYSTEM_CONTEXT, 'org-a', s);
		expect(s.getConfig).toHaveBeenCalledTimes(2);
	});

	it('never hands one caller’s answer to another', async () => {
		const resolver = createServerResolver();
		const s = store();
		await resolver.resolve(user('u1'), 'org-a', s);
		await resolver.resolve(user('u2'), 'org-a', s);
		await resolver.resolve(user('u1', ['instance_admin']), 'org-a', s);
		await resolver.resolve(user('u1'), 'org-a', s);
		expect(s.getConfig).toHaveBeenCalledTimes(3);
	});

	it('never remembers a share link’s anonymous context', async () => {
		const resolver = createServerResolver();
		const s = store();
		const share = { ...SYSTEM_CONTEXT, shareLinkId: 'link-1' } as RequestContext;
		await resolver.resolve(share, 'org-a', s);
		await resolver.resolve(share, 'org-a', s);
		expect(s.getConfig).toHaveBeenCalledTimes(2);
	});

	it('reads again past the TTL, and keeps no failed read', async () => {
		const resolver = createServerResolver({ ttlMs: 1 });
		const s = store();
		s.getConfig.mockRejectedValueOnce(new Error('db away'));
		await expect(resolver.resolve(SYSTEM_CONTEXT, 'org-a', s)).rejects.toThrow('db away');
		expect((await resolver.resolve(SYSTEM_CONTEXT, 'org-a', s)).id).toBe('srv-1');
		await new Promise((r) => setTimeout(r, 5));
		await resolver.resolve(SYSTEM_CONTEXT, 'org-a', s);
		expect(s.getConfig).toHaveBeenCalledTimes(3);
	});

	it('keeps answers per store', async () => {
		const resolver = createServerResolver();
		const [a, b] = [store(), store()];
		await resolver.resolve(SYSTEM_CONTEXT, 'org-a', a);
		await resolver.resolve(SYSTEM_CONTEXT, 'org-a', b);
		expect(a.getConfig).toHaveBeenCalledTimes(1);
		expect(b.getConfig).toHaveBeenCalledTimes(1);
	});
});
