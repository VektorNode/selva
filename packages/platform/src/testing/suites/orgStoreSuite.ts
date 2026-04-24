/**
 * Adapter conformance suite for IOrgStore.
 *
 * Tests organization CRUD and org membership management to ensure all
 * adapters behave identically.
 */

import { describe, it, expect } from 'vitest';
import type { IOrgStore } from '../../data/interface.js';
import type { Organization, OrgMember, OrgRole } from '../../index.js';
import { DEFAULT_ORG_PERMISSIONS } from '../../organizations/schemas.js';
import { makeCtx, makeUuid } from './helpers.js';

export interface OrgStoreConformanceOptions {
	/** Name to show in test output (e.g. "local-provider"). */
	name: string;
	/** Factory that returns a fresh, empty store per test. */
	createStore: () => Promise<IOrgStore> | IOrgStore;
	/** If true, skip createOrg/deleteOrg tests (e.g. single-org providers). */
	singleOrgMode?: boolean;
	/** If true, run ctx-isolation tests (adapters with row-level security). */
	ctxIsolation?: boolean;
}

const ctx = makeCtx;

function org(overrides: Partial<Organization> = {}): Organization {
	const now = new Date().toISOString();
	return {
		id: overrides.id ?? makeUuid(),
		name: overrides.name ?? 'Test Org',
		slug: overrides.slug ?? `test-${Math.random().toString(36).slice(2, 8)}`,
		ownerId: overrides.ownerId ?? 'user-1',
		createdAt: overrides.createdAt ?? now,
		updatedAt: overrides.updatedAt ?? now,
		...overrides
	};
}

function member(orgId: string, userId: string, role: OrgRole = 'member'): OrgMember {
	return {
		orgId,
		userId,
		role,
		permissions: [...DEFAULT_ORG_PERMISSIONS[role]],
		joinedAt: new Date().toISOString()
	};
}

export function runOrgStoreConformance(opts: OrgStoreConformanceOptions): void {
	const { name, createStore, singleOrgMode = false, ctxIsolation = false } = opts;

	describe(`IOrgStore conformance: ${name}`, () => {
		// ============================================================================
		// Organizations
		// ============================================================================

		if (!singleOrgMode) {
			it('createOrg + getOrg returns the organization', async () => {
				const store = await createStore();
				const o = org({ id: 'o1', slug: 'acme' });
				await store.createOrg(ctx('u1'), o);
				const got = await store.getOrg(ctx('u1'), 'o1');
				expect(got?.name).toBe('Test Org');
				expect(got?.slug).toBe('acme');
			});

			it('getOrg returns null for missing id', async () => {
				const store = await createStore();
				const got = await store.getOrg(ctx('u1'), 'nonexistent');
				expect(got).toBeNull();
			});

			it('getOrgBySlug finds org by slug', async () => {
				const store = await createStore();
				await store.createOrg(ctx('u1'), org({ id: 'o1', slug: 'acme-corp' }));
				const got = await store.getOrgBySlug(ctx('u1'), 'acme-corp');
				expect(got?.id).toBe('o1');
			});

			it('getOrgBySlug returns null for missing slug', async () => {
				const store = await createStore();
				const got = await store.getOrgBySlug(ctx('u1'), 'nonexistent');
				expect(got).toBeNull();
			});

			it('updateOrg modifies name and slug', async () => {
				const store = await createStore();
				await store.createOrg(ctx('u1'), org({ id: 'o1', slug: 'old-slug' }));
				await store.updateOrg(ctx('u1'), 'o1', { name: 'New Name', slug: 'new-slug' });
				const got = await store.getOrg(ctx('u1'), 'o1');
				expect(got?.name).toBe('New Name');
				expect(got?.slug).toBe('new-slug');
			});

			it('deleteOrg removes the organization', async () => {
				const store = await createStore();
				await store.createOrg(ctx('u1'), org({ id: 'o1' }));
				await store.deleteOrg(ctx('u1'), 'o1');
				const got = await store.getOrg(ctx('u1'), 'o1');
				expect(got).toBeNull();
			});

			it('listOrgs returns all organizations with pagination', async () => {
				const store = await createStore();
				for (let i = 0; i < 3; i++) {
					await store.createOrg(ctx('u1'), org({ id: `o${i}` }));
				}
				const page = await store.listOrgs(ctx('u1'), { limit: 2 });
				expect(page.items.length).toBe(2);
				expect(page.nextCursor).toBeTruthy();
			});
		} else {
			it('getOrg returns the default organization', async () => {
				const store = await createStore();
				const orgs = await store.listOrgs(ctx('u1'));
				expect(orgs.items.length > 0).toBe(true);
			});
		}

		// ============================================================================
		// Org Members
		// ============================================================================

		it('addOrgMember + getOrgMember returns the member', async () => {
			const store = await createStore();
			const orgs = await store.listOrgs(ctx('u1'));
			const orgId = singleOrgMode ? orgs.items[0].id : 'o1';
			if (!singleOrgMode) await store.createOrg(ctx('u1'), org({ id: orgId }));
			await store.addOrgMember(ctx('u1'), member(orgId, 'u2'));
			const got = await store.getOrgMember(ctx('u1'), orgId, 'u2');
			expect(got?.role).toBe('member');
		});

		it('getOrgMember returns null for missing member', async () => {
			const store = await createStore();
			const orgs = await store.listOrgs(ctx('u1'));
			const orgId = singleOrgMode ? orgs.items[0].id : 'o1';
			if (!singleOrgMode) await store.createOrg(ctx('u1'), org({ id: orgId }));
			const got = await store.getOrgMember(ctx('u1'), orgId, 'nonexistent');
			expect(got).toBeNull();
		});

		it('updateOrgMemberRole changes role', async () => {
			const store = await createStore();
			const orgs = await store.listOrgs(ctx('u1'));
			const orgId = singleOrgMode ? orgs.items[0].id : 'o1';
			if (!singleOrgMode) await store.createOrg(ctx('u1'), org({ id: orgId }));
			await store.addOrgMember(ctx('u1'), member(orgId, 'u2'));
			await store.updateOrgMemberRole(ctx('u1'), orgId, 'u2', 'admin');
			const got = await store.getOrgMember(ctx('u1'), orgId, 'u2');
			expect(got?.role).toBe('admin');
		});

		it('removeOrgMember deletes the member', async () => {
			const store = await createStore();
			const orgs = await store.listOrgs(ctx('u1'));
			const orgId = singleOrgMode ? orgs.items[0].id : 'o1';
			if (!singleOrgMode) await store.createOrg(ctx('u1'), org({ id: orgId }));
			await store.addOrgMember(ctx('u1'), member(orgId, 'u2'));
			await store.removeOrgMember(ctx('u1'), orgId, 'u2');
			const got = await store.getOrgMember(ctx('u1'), orgId, 'u2');
			expect(got).toBeNull();
		});

		it('listOrgMembers returns members with pagination', async () => {
			const store = await createStore();
			const orgs = await store.listOrgs(ctx('u1'));
			const orgId = singleOrgMode ? orgs.items[0].id : 'o1';
			if (!singleOrgMode) await store.createOrg(ctx('u1'), org({ id: orgId }));
			for (let i = 0; i < 3; i++) {
				await store.addOrgMember(ctx('u1'), member(orgId, `u${i}`));
			}
			const page = await store.listOrgMembers(ctx('u1'), orgId, { limit: 2 });
			expect(page.items.length).toBe(2);
		});

		if (ctxIsolation) {
			it('ctx isolation: orgs created by one user are not visible to another', async () => {
				const store = await createStore();
				await store.createOrg(ctx('user-a'), org({ id: 'org-a', slug: 'org-a' }));

				const page = await store.listOrgs(ctx('user-b'));
				expect(page.items.map((o) => o.id)).not.toContain('org-a');
			});

			it('ctx isolation: user cannot get an org they do not own', async () => {
				const store = await createStore();
				await store.createOrg(ctx('user-a'), org({ id: 'org-a', slug: 'org-a' }));

				const got = await store.getOrg(ctx('user-b'), 'org-a');
				expect(got).toBeNull();
			});
		}
	});
}
